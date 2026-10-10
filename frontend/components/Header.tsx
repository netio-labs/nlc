"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useLocale, useTranslations } from "next-intl";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { LOCALE_COOKIE, type Locale } from "@/i18n/config";

const USERNAME = "admin";

export default function Header() {
  const router = useRouter();
  const t = useTranslations("header");
  const locale = useLocale();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  // The account menu uses Radix components (useId). On async-RSC routes (e.g.
  // /console) their SSR id numbering can diverge from the client and trigger a
  // hydration mismatch. Mounting them only after hydration keeps SSR and the
  // first client render identical (a plain button), then swaps in the real menu.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  function switchLocale(next: Locale) {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }
  const navLinks = [
    { href: "/labs", label: t("labs") },
    { href: "/settings", label: t("settings") },
    { href: "/docs", label: t("docs") },
  ];

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b bg-card">
      <div className="mx-auto flex h-16 w-full items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-end">
            <img src="/logo.png" alt="nlc-logo" className="h-12 w-auto" />
            <span className="ml-2 text-sm text-muted-foreground">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
              {process.env.NEXT_PUBLIC_GIT_SHA && ` (${process.env.NEXT_PUBLIC_GIT_SHA})`}
            </span>
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            {navLinks.map((link) => (
              <Link key={link.label} href={link.href} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {/* Labelled with the language it switches to, in that language. */}
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => switchLocale(locale === "zh" ? "en" : "zh")}>
            {locale === "zh" ? "EN" : "中文"}
          </Button>
          {/* resolvedTheme is unknown during SSR; render the icon only after mount. */}
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={t("toggleTheme")}
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {mounted && (resolvedTheme === "dark" ? <SunIcon className="size-5" /> : <MoonIcon className="size-5" />)}
          </Button>
          {mounted ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="rounded-full">
                  {USERNAME.charAt(0).toUpperCase()}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setChangePasswordOpen(true)}>{t("changePassword")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleLogout()}>{t("logout")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            // SSR / pre-hydration placeholder: identical button, no Radix (no useId).
            <Button variant="outline" size="icon" className="rounded-full">
              {USERNAME.charAt(0).toUpperCase()}
            </Button>
          )}
        </div>
      </div>
      {mounted && <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />}
    </header>
  );
}
