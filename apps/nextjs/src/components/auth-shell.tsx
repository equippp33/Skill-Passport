import type { ReactNode } from "react";
import { Brand, BrandMark } from "~/components/brand";
import { Icon } from "~/components/ui/icon";
import type { Messages } from "~/config/messages";

export function AuthShell({
  children,
  m,
  lang,
}: {
  children: ReactNode;
  m: Messages;
  lang: string;
}) {
  return (
    <main lang={lang} className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="auth-story relative hidden flex-col justify-between overflow-hidden border-r border-border-subtle p-12 lg:flex xl:p-16">
        <Brand />
        <div className="relative z-10 my-12 max-w-lg">
          <span className="eyebrow">
            <Icon name="spark" className="size-4" /> {m.app.tagline}
          </span>
          <h2 className="mt-6 text-4xl leading-snug font-semibold tracking-tight xl:text-5xl">
            {m.dashboard.subtitle}
          </h2>
          <div className="mt-10 rounded-2xl border border-white bg-white/90 p-6 shadow-[var(--shadow-raised)]">
            <div className="flex items-center gap-3">
              <BrandMark className="size-12" />
              <div>
                <p className="font-semibold">{m.dashboard.assessmentName}</p>
                <p className="mt-1 text-sm text-content-muted">
                  {m.instructions.ownLanguageTitle}
                </p>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                m.skills.communication,
                m.skills.teamwork,
                m.skills.reliability,
              ].map((skill, index) => (
                <div
                  key={skill}
                  className="space-y-3 rounded-xl bg-accent-soft p-3"
                >
                  <Icon
                    name={
                      index === 0 ? "mic" : index === 1 ? "people" : "shield"
                    }
                    className="size-5 text-accent"
                  />
                  <p className="text-xs font-medium leading-relaxed text-accent">
                    {skill}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="flex items-center gap-2 text-sm text-content-muted">
          <Icon name="shield" /> {m.app.tagline}
        </p>
      </section>
      <section className="flex flex-col px-5 py-8 sm:px-10 lg:px-16">
        <div className="mb-10 lg:hidden">
          <Brand />
        </div>
        <div className="m-auto w-full max-w-md py-6">{children}</div>
        <p className="mt-8 text-center text-xs text-content-muted">
          Skill Passport · {m.app.tagline}
        </p>
      </section>
    </main>
  );
}
