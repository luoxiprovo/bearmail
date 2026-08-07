import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

type NavigateOptions = { replace?: boolean; state?: unknown };
type Navigate = (to: string | number, options?: NavigateOptions) => void;
interface RouterValue { path: string; state: unknown; navigate: Navigate }

const RouterContext = createContext<RouterValue | null>(null);

export function Router({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(() => ({ path: window.location.pathname, state: history.state }));
  useEffect(() => {
    const onPopState = () => setLocation({ path: window.location.pathname, state: history.state });
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = useCallback<Navigate>((to, options) => {
    if (typeof to === "number") { history.go(to); return; }
    if (options?.replace) history.replaceState(options.state ?? null, "", to);
    else history.pushState(options?.state ?? null, "", to);
    setLocation({ path: window.location.pathname, state: history.state });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  const value = useMemo(() => ({ ...location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useNavigate(): Navigate { return useRouter().navigate; }
export function usePath(): string { return useRouter().path; }
export function useLocationState<T>(): T | null { return (useRouter().state as T | null) ?? null; }

export function NavLink({ to, children, className = "", ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const { path, navigate } = useRouter();
  const active = path === to || (to === "/mail" && path.startsWith("/mail/"));
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    props.onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(to);
  };
  return <a {...props} href={to} onClick={click} className={`${className} ${active ? "active" : ""}`.trim()}>{children}</a>;
}

function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error("Router components must be inside Router");
  return value;
}
