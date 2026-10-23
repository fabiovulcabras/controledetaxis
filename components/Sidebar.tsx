import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/UI";
import type { NivelMenu } from "@/components/AuthGate";
import { useAlertas } from "@/components/AlertasPlanejamento";

type Props = {
  path: string;
  nav: [string, string, NivelMenu][];
  planejamento: boolean;
  admin: boolean;
  profileName: string;
  onSignOut: () => void;
  open: boolean;
  onClose: () => void;
};

export default function Sidebar({ path, nav, planejamento, admin, profileName, onSignOut, open, onClose }: Props) {
  const ativo = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const { excecoes } = useAlertas();
  return (
    <>
      <button type="button" className={`drawer-backdrop${open ? " visible" : ""}`} aria-label="Fechar menu" tabIndex={open ? 0 : -1} onClick={onClose} />
      <nav className={`side${open ? " open" : ""}`} aria-label="Navegação principal">
        <div className="side-brand">
          <BrandMark />
          <h1>Controle de Táxis</h1>
          <button type="button" className="side-close" aria-label="Fechar menu" onClick={onClose}>
            <span />
            <span />
          </button>
        </div>
        {nav.filter(([, , nivel]) => nivel === "todos" || (nivel === "planejamento" && planejamento) || (nivel === "admin" && admin)).map(([href, label]) => (
          <Link key={href} href={href} className={ativo(href) ? "on" : ""} onClick={onClose}>
            {label}
            {href === "/" && planejamento && excecoes > 0 && <span className="contador-menu" aria-label={`${excecoes} exceções`}>{excecoes}</span>}
          </Link>
        ))}
        <div style={{ flex: 1 }} />
        <Button type="button" variant="secondary" className="side-signout" onClick={onSignOut}>
          Sair ({profileName})
        </Button>
      </nav>
    </>
  );
}
