/**
 * Harness supplies this baseline module through its browser ModuleLoader.
 * These declarations describe the public props used from version 0.2.1-rc.2;
 * no implementation, stylesheet, React runtime or component is copied here.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ButtonHTMLAttributes, ComponentType, InputHTMLAttributes, ReactNode } from 'react';

  export const Button: ComponentType<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      variant?: 'ghost' | 'outline' | 'primary';
      size?: 'sm' | 'md';
      icon?: ReactNode;
    }
  >;

  export const Switch: ComponentType<{
    label: string;
    checked: boolean;
    onChange(value: boolean): void;
    disabled?: boolean;
  }>;

  export const Input: ComponentType<InputHTMLAttributes<HTMLInputElement>>;

  export const SegmentedControl: ComponentType<{
    id: string;
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange(value: string): void;
    disabled?: boolean;
  }>;

  export const Menu: ComponentType<{
    open: boolean;
    portal: boolean;
    autoFocus: boolean;
    compact?: boolean;
    items: { id: string; label: string; disabled?: boolean }[];
    selectedId?: string;
    onSelect(id: string): void;
    onClose(): void;
    anchor: ReactNode;
  }>;

  export const Modal: ComponentType<{
    open: boolean;
    title: string;
    closeLabel: string;
    description?: string;
    onClose(): void;
    children?: ReactNode;
    footer?: ReactNode;
  }>;

  export const Tag: ComponentType<{ tone?: 'neutral' | 'quiet'; children?: ReactNode }>;
  export const IconChevronDownOutlineRegular: ComponentType<{ size?: number }>;
  export const IconPaperclipOutlineRegular: ComponentType<{ size?: number }>;
  export const IconTrashOutlineRegular: ComponentType<{ size?: number }>;
  export const IconPlayOutlineRegular: ComponentType<{ size?: number }>;
  export const IconPauseOutlineRegular: ComponentType<{ size?: number }>;
  export function fileSizeText(bytes: number): string;
}
