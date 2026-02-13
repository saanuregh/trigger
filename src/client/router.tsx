import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

interface Route {
  pattern: string;
  component: () => ReactNode;
}

interface RouteMatch {
  path: string;
  params: Record<string, string>;
}

const RouteContext = createContext<RouteMatch>({
  path: "/",
  params: {},
});

function compilePath(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = pattern.replace(/:([^/]+)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

function matchRoutes(path: string, routes: Route[]): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    const { regex, paramNames } = compilePath(route.pattern);
    const match = path.match(regex);
    if (match) {
      const params: Record<string, string> = {};
      for (let i = 0; i < paramNames.length; i++) {
        params[paramNames[i]!] = decodeURIComponent(match[i + 1]!);
      }
      return { route, params };
    }
  }
  return null;
}

export function navigate(to: string) {
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}

export function RouterProvider({ routes, fallback: Fallback }: { routes: Route[]; fallback?: Route["component"] }) {
  const [path, setPath] = useState(location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(location.pathname);
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    document.querySelector("main")?.scrollTo(0, 0);
  }, [path]);

  const matched = matchRoutes(path, routes);
  const Page = matched?.route.component ?? Fallback;
  const routeValue: RouteMatch = {
    path,
    params: matched?.params ?? {},
  };

  return <RouteContext value={routeValue}>{Page ? <Page /> : null}</RouteContext>;
}

export function useRoute() {
  return useContext(RouteContext);
}

interface LinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
  children: ReactNode;
}

export function Link({ to, children, onClick, ...props }: LinkProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onClick) onClick(e);
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(to);
  };

  return (
    <a href={to} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}
