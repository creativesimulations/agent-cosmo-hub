import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center gradient-bg">
      <div className="text-center space-y-4">
        <h1 className="text-5xl font-bold text-foreground">404</h1>
        <p className="text-lg text-muted-foreground">
          We couldn't find <code className="font-mono text-sm">{location.pathname}</code>.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            to="/dashboard"
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm"
          >
            Go to Dashboard
          </Link>
          <Link
            to="/chat"
            className="px-4 py-2 rounded-md border border-border text-foreground hover:bg-muted/40 transition-colors text-sm"
          >
            Open Agent Chat
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
