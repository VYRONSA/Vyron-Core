"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Menu, X } from "lucide-react";
import { navItems } from "@/lib/marketing/site";
import { links } from "@/lib/marketing/umora";
import s from "./umora.module.css";

// Disclosure-based menu so it still opens without JavaScript; the client code
// only closes it again after navigation, since the shell persists across routes.
export default function MobileMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  const close = () => {
    if (ref.current) ref.current.open = false;
  };

  return (
    <details ref={ref} className={s.shellMenu}>
      <summary aria-label="Menu">
        <Menu size={20} className={s.shellMenuOpen} />
        <X size={20} className={s.shellMenuClose} />
      </summary>
      <nav className={s.shellMenuPanel} aria-label="Mobile">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} onClick={close}>
            {item.label}
          </Link>
        ))}
        <Link href={links.demo} onClick={close} className={`${s.btn} ${s.btnGold}`}>
          Book a demo
        </Link>
        <Link href={links.login} onClick={close} className={`${s.btn} ${s.shellLogin}`}>
          Login
        </Link>
      </nav>
    </details>
  );
}
