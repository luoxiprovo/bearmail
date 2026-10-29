/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { DynamicIcon } from '@/components/common/DynamicIcon';
import { EnterpriseUpsell } from '@/components/common/EnterpriseUpsell';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUIStore } from '@/stores/uiStore';
import type { Layout } from '@/types/schema';
import { layoutNavNodes, navNodeKey, pathMatchesView, someLink, viewPath, type NavNode } from './navTree';
import { SIDEBAR_ID, SidebarNavContext, useSidebarNav } from './sidebarContext';
import { useLayoutNavigation } from './useLayoutNavigation';

function indent(depth: number): CSSProperties | undefined {
  return depth > 0 ? { paddingInlineStart: `${(depth + 1) * 12 + 8}px` } : undefined;
}

const itemClass = 'w-full justify-start gap-2 font-normal';

function NavLink({ node, depth }: { node: Extract<NavNode, { kind: 'link' }>; depth: number }) {
  const { t } = useTranslation();
  const nav = useSidebarNav();
  const ref = useRef<HTMLAnchorElement>(null);
  const isActive = pathMatchesView(nav.pathname, nav.sectionName, node.viewName);

  useEffect(() => {
    if (isActive) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [isActive]);

  if (!nav.isVisible(node.viewName)) return null;

  const label = node.name || t('sidebar.overview', 'Overview');
  const content = (
    <>
      {node.icon && <DynamicIcon name={node.icon} className="h-4 w-4 shrink-0" />}
      <span className="truncate">{label}</span>
    </>
  );
  const className = cn(buttonVariants({ variant: 'ghost' }), itemClass, depth > 0 && 'text-sm');

  if (nav.isLocked(node.viewName)) {
    return (
      <button
        type="button"
        className={className}
        style={indent(depth)}
        onClick={nav.openUpsell}
        aria-describedby={nav.lockedHintId}
      >
        {content}
        <Lock aria-hidden="true" className="ml-auto h-3 w-3 text-muted-foreground" />
      </button>
    );
  }

  return (
    <Link
      ref={ref}
      to={viewPath(nav.sectionName, node.viewName)}
      aria-current={isActive ? 'page' : undefined}
      className={cn(className, isActive && 'bg-accent text-accent-foreground')}
      style={indent(depth)}
    >
      {content}
    </Link>
  );
}

function NavContainer({ node, depth }: { node: Extract<NavNode, { kind: 'container' }>; depth: number }) {
  const nav = useSidebarNav();
  const containsActive = someLink(node.children, (viewName) =>
    pathMatchesView(nav.pathname, nav.sectionName, viewName),
  );
  const [open, setOpen] = useState(containsActive);
  const [prevContainsActive, setPrevContainsActive] = useState(containsActive);
  if (containsActive !== prevContainsActive) {
    setPrevContainsActive(containsActive);
    if (containsActive) setOpen(true);
  }

  if (!someLink(node.children, nav.isVisible)) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className={cn(itemClass, depth > 0 && 'text-sm')} style={indent(depth)}>
          {depth > 0 && (
            <ChevronDown
              aria-hidden="true"
              className="h-3 w-3 shrink-0 transition-transform duration-200 [[data-state=closed]>&]:rotate-[-90deg]"
            />
          )}
          {node.icon && <DynamicIcon name={node.icon} className="h-4 w-4 shrink-0" />}
          <span className="truncate">{node.name}</span>
          {depth === 0 && (
            <ChevronDown
              aria-hidden="true"
              className="ml-auto h-3 w-3 shrink-0 transition-transform duration-200 [[data-state=closed]>&]:rotate-[-90deg]"
            />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <NavNodes nodes={node.children} depth={depth + 1} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function NavNodes({ nodes, depth }: { nodes: NavNode[]; depth: number }) {
  return nodes.map((node) =>
    node.kind === 'link' ? (
      <NavLink key={navNodeKey(node)} node={node} depth={depth} />
    ) : (
      <NavContainer key={navNodeKey(node)} node={node} depth={depth} />
    ),
  );
}

function SectionSwitcher({ layouts, activeSection }: { layouts: Layout[]; activeSection: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActiveSection = useUIStore((s) => s.setActiveSection);
  const { landingPath } = useLayoutNavigation();

  return (
    <div
      role="group"
      aria-label={t('sections', 'Sections')}
      className="flex items-center justify-around border-t bg-background px-2 py-2"
    >
      {layouts.map((target) => {
        const isActive = target.name === activeSection;
        return (
          <Tooltip key={target.name}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={target.name}
                aria-pressed={isActive}
                onClick={() => {
                  setActiveSection(target.name);
                  const path = landingPath(target);
                  if (path) navigate(path);
                }}
                className={cn('h-9 w-9', isActive && 'bg-accent text-accent-foreground')}
              >
                <DynamicIcon name={target.icon} className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{target.name}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const activeSection = useUIStore((s) => s.activeSection);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const { layouts, isVisible, isLocked } = useLayoutNavigation();
  const [upsellOpen, setUpsellOpen] = useState(false);
  const lockedHintId = useId();

  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);

  if (!sidebarOpen) return null;
  const layout = layouts.find((l) => l.name === activeSection);
  if (!layout) return null;

  const nav = {
    sectionName: layout.name,
    pathname,
    isVisible,
    isLocked,
    openUpsell: () => setUpsellOpen(true),
    lockedHintId,
  };

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 top-14 z-20 bg-black/40 md:hidden"
        onClick={() => setSidebarOpen(false)}
      />
      <aside
        id={SIDEBAR_ID}
        aria-label={t('sidebar.label', 'Sidebar')}
        className="fixed bottom-0 left-0 top-14 z-30 flex w-64 flex-col border-r bg-background"
      >
        <span id={lockedHintId} className="sr-only">
          {t('enterprise.featureHint', 'Enterprise feature')}
        </span>
        <div className="flex-1 overflow-y-auto py-2 [scrollbar-width:thin]">
          <nav aria-label={layout.name} className="flex flex-col gap-0.5 px-2">
            <SidebarNavContext value={nav}>
              <NavNodes nodes={layoutNavNodes(layout)} depth={0} />
            </SidebarNavContext>
          </nav>
        </div>

        {layouts.length > 1 && <SectionSwitcher layouts={layouts} activeSection={activeSection} />}

        <EnterpriseUpsell open={upsellOpen} onClose={() => setUpsellOpen(false)} />
      </aside>
    </>
  );
}
