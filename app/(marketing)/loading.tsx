import { UmoraMark } from "@/components/marketing/umora/visuals";
import { UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";
import s from "@/components/marketing/umora/umora.module.css";

export default function MarketingLoading() {
  return (
    <UmoraPage>
      <section className={p.hero} aria-busy="true" aria-label="Loading">
        <div className={s.heroBackdrop} aria-hidden="true" />
        <div className={s.container} style={{ position: "relative", display: "grid", placeItems: "center", minHeight: "40vh" }}>
          <UmoraMark size={48} />
        </div>
      </section>
    </UmoraPage>
  );
}
