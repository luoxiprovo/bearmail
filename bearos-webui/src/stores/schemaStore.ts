/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { create } from 'zustand';
import { layoutViewFor } from '@/lib/layout';
import type { Schema, LayoutSubItem } from '@/types/schema';

export interface SearchIndexEntry {
  text: string;
  type: 'link' | 'field' | 'form';
  viewName: string;
  section: string;
  breadcrumb: string;
  icon?: string;
  objectType?: 'object' | 'singleton' | 'view';
  keywords?: string[];
}

interface SchemaState {
  schema: Schema | null;
  isLoaded: boolean;
  viewToSection: Record<string, string>;
  searchIndex: SearchIndexEntry[];

  setSchema: (schema: Schema) => void;
}

function walkLayouts(schema: Schema): { viewToSection: Record<string, string>; linkEntries: SearchIndexEntry[] } {
  const viewToSection: Record<string, string> = {};
  const linkEntries: SearchIndexEntry[] = [];

  function visit(items: LayoutSubItem[], sectionName: string, parentPath: string): void {
    for (const sub of items) {
      if (sub.type === 'link') {
        if (!(sub.viewName in viewToSection)) {
          viewToSection[sub.viewName] = sectionName;
        }
        linkEntries.push({
          text: sub.name,
          type: 'link',
          viewName: sub.viewName,
          section: sectionName,
          breadcrumb: `${parentPath} > ${sub.name}`,
        });
      } else if (sub.type === 'container') {
        visit(sub.items, sectionName, `${parentPath} > ${sub.name}`);
      }
    }
  }

  for (const layout of schema.layouts) {
    const sectionName = layout.name;
    for (const item of layout.items) {
      if ('link' in item) {
        if (!(item.link.viewName in viewToSection)) {
          viewToSection[item.link.viewName] = sectionName;
        }
        linkEntries.push({
          text: item.link.name,
          type: 'link',
          viewName: item.link.viewName,
          section: sectionName,
          breadcrumb: `${sectionName} > ${item.link.name}`,
          icon: item.link.icon,
        });
      } else if ('container' in item) {
        visit(item.container.items, sectionName, `${sectionName} > ${item.container.name}`);
      }
    }
  }

  return { viewToSection, linkEntries };
}

function buildSearchIndex(
  schema: Schema,
  viewToSection: Record<string, string>,
  linkEntries: SearchIndexEntry[],
): SearchIndexEntry[] {
  const entries: SearchIndexEntry[] = [...linkEntries];

  function displayNameFor(viewName: string): string {
    const obj = schema.objects[viewName];
    if (!obj) return viewName.replace(/^x:/, '');
    let resolvedName = viewName;
    let resolvedObj = obj;
    if (obj.type === 'view') {
      const parent = schema.objects[obj.objectName];
      if (parent && parent.type !== 'view') {
        resolvedName = obj.objectName;
        resolvedObj = parent;
      }
    }
    if (resolvedObj.type === 'singleton') {
      const form = schema.forms[viewName] ?? schema.forms[resolvedName];
      if (form?.title) return form.title;
    }
    if (resolvedObj.type === 'object') {
      const list = schema.lists[viewName] ?? schema.lists[resolvedName];
      if (list?.singularName) {
        return list.singularName.charAt(0).toUpperCase() + list.singularName.slice(1);
      }
    }
    return viewName.replace(/^x:/, '');
  }

  for (const [name, obj] of Object.entries(schema.objects)) {
    if (obj.type !== 'view' && obj.description) {
      const viewName = layoutViewFor(schema, viewToSection, name);
      if (!viewName) continue;
      const section = viewToSection[viewName];
      const display = displayNameFor(viewName);
      entries.push({
        text: obj.description,
        type: 'link',
        viewName,
        section,
        breadcrumb: `${section} > ${display}`,
        objectType: obj.type,
      });
    }
  }

  for (const [formKey, form] of Object.entries(schema.forms)) {
    const mapped = schema.objects[formKey] ? layoutViewFor(schema, viewToSection, formKey) : formKey;
    if (!mapped) continue;
    const viewName = mapped;
    const section = viewToSection[viewName] ?? '';
    const display = displayNameFor(viewName);

    for (const formSection of form.sections) {
      if (formSection.title) {
        entries.push({
          text: formSection.title,
          type: 'form',
          viewName,
          section,
          breadcrumb: section ? `${section} > ${display} > ${formSection.title}` : `${display} > ${formSection.title}`,
        });
      }

      for (const field of formSection.fields) {
        const keywords: string[] = [];
        if (field.name && field.name !== '@type') {
          keywords.push(field.name);
        }
        entries.push({
          text: field.label,
          type: 'field',
          viewName,
          section,
          breadcrumb: section ? `${section} > ${display} > ${field.label}` : `${display} > ${field.label}`,
          keywords,
        });
      }
    }
  }

  return entries;
}

export const useSchemaStore = create<SchemaState>()((set) => ({
  schema: null,
  isLoaded: false,
  viewToSection: {},
  searchIndex: [],

  setSchema: (schema) => {
    const { viewToSection, linkEntries } = walkLayouts(schema);
    const searchIndex = buildSearchIndex(schema, viewToSection, linkEntries);
    set({
      schema,
      isLoaded: true,
      viewToSection,
      searchIndex,
    });
  },
}));
