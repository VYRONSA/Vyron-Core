"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { platformFetch } from "@/lib/platform/platform-client";

type SearchResult = {
  type: "company" | "user" | "employee";
  id: string;
  label: string;
  sublabel: string | null;
  companyId: string | null;
};

export default function PlatformGlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [prevQuery, setPrevQuery] = useState(query);

  if (prevQuery !== query) {
    setPrevQuery(query);
    if (query.trim().length < 2) setResults([]);
  }

  useEffect(() => {
    if (query.trim().length < 2) {
      return;
    }
    const timeout = setTimeout(async () => {
      const result = await platformFetch<{ results: SearchResult[] }>(
        `/api/platform/search?q=${encodeURIComponent(query.trim())}`
      );
      if (result.ok) {
        setResults(result.data.results);
        setOpen(true);
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  function handleSelect(result: SearchResult) {
    setOpen(false);
    setQuery("");
    if (result.companyId) router.push(`/platform/customers/${result.companyId}`);
  }

  return (
    <div className="relative w-full max-w-sm">
      <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-white">
        <Search className="h-4 w-4 text-white/60" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim().length >= 2 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search companies, users, employees…"
          className="w-full bg-transparent text-sm text-white placeholder:text-white/50 outline-none"
        />
      </div>
      {open && results.length > 0 ? (
        <ul className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl bg-white shadow-xl">
          {results.map((result) => (
            <li key={`${result.type}-${result.id}`}>
              <button
                type="button"
                onClick={() => handleSelect(result)}
                className="flex w-full flex-col items-start px-4 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-bold text-slate-900">{result.label}</span>
                <span className="text-xs text-slate-500">
                  {result.type}
                  {result.sublabel ? ` · ${result.sublabel}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
