/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import type { FieldType } from '@/types/schema';

export type LabelMode = 'control' | 'group' | 'none';

export interface WidgetTraits {
  labelMode: LabelMode;
  readOnlyAsValue: boolean;
}

export type WidgetKey =
  | 'string'
  | 'string:secret'
  | 'string:multiline'
  | 'string:color'
  | 'number'
  | 'number:size'
  | 'number:duration'
  | 'utcDateTime'
  | 'boolean'
  | 'enum'
  | 'blobId'
  | 'objectId'
  | 'object'
  | 'object:x:Expression'
  | 'object:x:Rate'
  | 'object:x:OtpAuth'
  | 'objectList'
  | 'set'
  | 'set:enum'
  | 'map'
  | 'unsupported';

export function widgetKey(type: FieldType): WidgetKey {
  switch (type.type) {
    case 'string':
      switch (type.format) {
        case 'secret':
        case 'secretText':
          return 'string:secret';
        case 'text':
        case 'html':
        case 'sieve':
          return 'string:multiline';
        case 'color':
          return 'string:color';
        default:
          return 'string';
      }
    case 'number':
      return type.format === 'size' ? 'number:size' : type.format === 'duration' ? 'number:duration' : 'number';
    case 'object':
      switch (type.objectName) {
        case 'x:Expression':
          return 'object:x:Expression';
        case 'x:Rate':
          return 'object:x:Rate';
        case 'x:OtpAuth':
          return 'object:x:OtpAuth';
        default:
          return 'object';
      }
    case 'set':
      return type.class.type === 'enum' ? 'set:enum' : 'set';
    case 'utcDateTime':
    case 'boolean':
    case 'enum':
    case 'blobId':
    case 'objectId':
    case 'objectList':
    case 'map':
      return type.type;
    default:
      return 'unsupported';
  }
}

const TRAITS: Record<WidgetKey, WidgetTraits> = {
  string: { labelMode: 'control', readOnlyAsValue: true },
  'string:secret': { labelMode: 'control', readOnlyAsValue: true },
  'string:multiline': { labelMode: 'control', readOnlyAsValue: true },
  'string:color': { labelMode: 'control', readOnlyAsValue: true },
  number: { labelMode: 'control', readOnlyAsValue: true },
  'number:size': { labelMode: 'control', readOnlyAsValue: true },
  'number:duration': { labelMode: 'control', readOnlyAsValue: true },
  utcDateTime: { labelMode: 'control', readOnlyAsValue: true },
  boolean: { labelMode: 'control', readOnlyAsValue: true },
  enum: { labelMode: 'control', readOnlyAsValue: true },
  blobId: { labelMode: 'control', readOnlyAsValue: false },
  objectId: { labelMode: 'control', readOnlyAsValue: true },
  object: { labelMode: 'group', readOnlyAsValue: false },
  'object:x:Expression': { labelMode: 'group', readOnlyAsValue: false },
  'object:x:Rate': { labelMode: 'control', readOnlyAsValue: false },
  'object:x:OtpAuth': { labelMode: 'none', readOnlyAsValue: false },
  objectList: { labelMode: 'group', readOnlyAsValue: false },
  set: { labelMode: 'control', readOnlyAsValue: true },
  'set:enum': { labelMode: 'group', readOnlyAsValue: true },
  map: { labelMode: 'group', readOnlyAsValue: false },
  unsupported: { labelMode: 'none', readOnlyAsValue: false },
};

export function widgetTraits(type: FieldType): WidgetTraits {
  return TRAITS[widgetKey(type)];
}
