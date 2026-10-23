import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TableHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" };

export function Button({ variant, className = "", ...props }: ButtonProps) {
  const variantClass = variant
    ? variant === "secondary" ? "ghost" : variant === "danger" ? "danger" : "pri"
    : className.split(/\s+/).some((name) => ["ghost", "danger", "pri"].includes(name)) ? "" : "pri";
  return <button {...props} className={`${variantClass}${className ? ` ${className}` : ""}`} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}

type CardProps = HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" | "form" };

export function Card({ as: Element = "div", className = "", ...props }: CardProps) {
  return <Element {...props} className={`card${className ? ` ${className}` : ""}`} />;
}

export function Table({ className = "", ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table {...props} className={className} />;
}

type BadgeProps = HTMLAttributes<HTMLSpanElement> & { variant?: "neutral" | "success" | "warning" | "danger" };

export function Badge({ variant = "neutral", className = "", ...props }: BadgeProps) {
  const variantClass = variant === "success" ? "aprovada" : variant === "warning" ? "pendente" : variant === "danger" ? "reprovada" : "";
  return <span {...props} className={`tag${variantClass ? ` ${variantClass}` : ""}${className ? ` ${className}` : ""}`} />;
}

export function KpiCard({ value, label, alert = false }: { value: ReactNode; label: ReactNode; alert?: boolean }) {
  // A quantidade de caracteres define o tamanho da fonte (ver .kpi b no CSS).
  const texto = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const estilo = { "--chars": Math.max(texto.length, 4) } as CSSProperties;
  return <div className={`kpi${alert ? " warn" : ""}`}><b style={estilo} title={texto || undefined}>{value}</b><span>{label}</span></div>;
}

export function PageHeader({ title }: { title: ReactNode }) {
  return <h2>{title}</h2>;
}
