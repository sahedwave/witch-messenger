import { useEffect, useRef } from "react";

export function useHistoryBackLayer(isActive, onBack) {
  const activeRef = useRef(isActive);
  const onBackRef = useRef(onBack);
  const guardActiveRef = useRef(false);
  const ignoreNextPopRef = useRef(false);

  useEffect(() => {
    activeRef.current = isActive;
    onBackRef.current = onBack;
  }, [isActive, onBack]);

  useEffect(() => {
    function handlePopState() {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        guardActiveRef.current = false;
        return;
      }

      if (!activeRef.current) {
        guardActiveRef.current = false;
        return;
      }

      guardActiveRef.current = false;
      onBackRef.current?.();
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!isActive) {
      if (!guardActiveRef.current) {
        return;
      }

      ignoreNextPopRef.current = true;
      guardActiveRef.current = false;
      window.history.back();
      return;
    }

    if (guardActiveRef.current) {
      return;
    }

    window.history.pushState(
      {
        ...(window.history.state || {}),
        __witchBackLayer: true
      },
      "",
      window.location.href
    );
    guardActiveRef.current = true;
  }, [isActive]);
}
