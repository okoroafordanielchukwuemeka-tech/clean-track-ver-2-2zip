import { useEffect } from "react";

/**
 * Sets the browser tab title for the current page.
 * Automatically restores the previous title when the component unmounts.
 */
export function usePageTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} • CleanTrack`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
