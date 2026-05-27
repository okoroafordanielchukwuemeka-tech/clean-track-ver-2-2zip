import { useState } from "react";

export interface Toast {
  id: string;
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
}

let toastCount = 0;
const listeners: Array<(toasts: Toast[]) => void> = [];
let toasts: Toast[] = [];

function dispatch(toast: Toast) {
  toasts = [...toasts, toast];
  listeners.forEach(l => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== toast.id);
    listeners.forEach(l => l(toasts));
  }, 5000);
}

export function toast(props: Omit<Toast, "id">) {
  dispatch({ ...props, id: String(++toastCount) });
}

export function useToast() {
  const [state, setState] = useState<Toast[]>(toasts);
  if (!listeners.includes(setState)) listeners.push(setState);
  return {
    toasts: state,
    toast,
    dismiss: (id: string) => {
      toasts = toasts.filter(t => t.id !== id);
      listeners.forEach(l => l(toasts));
    },
  };
}
