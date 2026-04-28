"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  formatCategoryLabel,
  mapCategoryRowFromSupabase,
  sortCategoriesForPicker,
} from "@/lib/category-display";
import { isBuiltinPrimarySlug } from "@/lib/primary-category-slugs";
import type { CategoryRow, PrimaryCategoryGroupRow } from "@/types/finance";

export type { CategoryRow, PrimaryCategoryGroupRow } from "@/types/finance";

const PRESET_COLORS = [
  "#0ea5e9",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#6366f1",
  "#64748b",
];

type Props = {
  householdId: string;
  initialCategories: CategoryRow[];
  initialPrimaryGroups: PrimaryCategoryGroupRow[];
  embedded?: boolean;
};

function sortCategories(list: CategoryRow[]): CategoryRow[] {
  return [...list].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.name.localeCompare(b.name);
  });
}

function sortPrimaryGroups(
  list: PrimaryCategoryGroupRow[],
): PrimaryCategoryGroupRow[] {
  return [...list].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.name.localeCompare(b.name);
  });
}

export function CategoriesManager({
  householdId,
  initialCategories,
  initialPrimaryGroups,
  embedded = false,
}: Props) {
  const router = useRouter();
  const [categories, setCategories] = useState(() =>
    sortCategories(initialCategories),
  );
  const [primaryGroups, setPrimaryGroups] = useState(() =>
    sortPrimaryGroups(initialPrimaryGroups),
  );
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [newDescription, setNewDescription] = useState("");
  const [newCategoryPrimaryId, setNewCategoryPrimaryId] = useState<
    string | null
  >(null);
  const [newParentCategoryId, setNewParentCategoryId] = useState("");
  const [newPrimaryName, setNewPrimaryName] = useState("");
  const [newPrimaryColor, setNewPrimaryColor] = useState("#6366f1");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#6366f1");
  const [editDescription, setEditDescription] = useState("");
  const [editPrimaryGroupId, setEditPrimaryGroupId] = useState<string | null>(
    null,
  );
  const [editParentCategoryId, setEditParentCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleteMode, setDeleteMode] = useState<"move" | "clear">("move");
  const [moveToId, setMoveToId] = useState("");

  const maxSort = useMemo(
    () => categories.reduce((m, c) => Math.max(m, c.sort_order), -1),
    [categories],
  );

  const purchasesGroupId = useMemo(
    () => primaryGroups.find((g) => g.slug === "purchases_bills")?.id ?? null,
    [primaryGroups],
  );

  const topLevelCategories = useMemo(
    () => categories.filter((c) => !c.parent_category_id),
    [categories],
  );

  const topLevelSorted = useMemo(
    () => sortCategories(topLevelCategories),
    [topLevelCategories],
  );

  useEffect(() => {
    setPrimaryGroups(sortPrimaryGroups(initialPrimaryGroups));
  }, [initialPrimaryGroups]);

  useEffect(() => {
    if (newCategoryPrimaryId) return;
    if (purchasesGroupId) setNewCategoryPrimaryId(purchasesGroupId);
  }, [purchasesGroupId, newCategoryPrimaryId]);

  const otherCategories = useMemo(() => {
    if (!pendingDelete) return [];
    return categories.filter((c) => c.id !== pendingDelete.id);
  }, [categories, pendingDelete]);

  useEffect(() => {
    setCategories(sortCategories(initialCategories));
  }, [initialCategories]);

  function primarySelectValue(category: CategoryRow): string {
    return category.primary_group_id ?? purchasesGroupId ?? "";
  }

  useEffect(() => {
    if (!pendingDelete) return;
    if (otherCategories.length === 0) {
      setDeleteMode("clear");
      setMoveToId("");
    } else {
      setDeleteMode("move");
      setMoveToId((prev) => {
        if (prev && otherCategories.some((c) => c.id === prev)) return prev;
        return otherCategories[0]!.id;
      });
    }
  }, [pendingDelete, otherCategories]);

  function syncFromServer() {
    router.refresh();
  }

  async function patchCategoryPrimary(categoryId: string, primaryGroupId: string) {
    const cat = categories.find((c) => c.id === categoryId);
    if (cat?.parent_category_id) {
      setError(
        "Subcategories use the same primary as their parent — change the parent category’s primary group.",
      );
      return;
    }
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: uerr } = await supabase
      .from("categories")
      .update({ primary_group_id: primaryGroupId })
      .eq("id", categoryId)
      .eq("household_id", householdId);
    setLoading(false);
    if (uerr) {
      setError(uerr.message);
      return;
    }
    setCategories(
      sortCategories(
        categories.map((c) =>
          c.id === categoryId
            ? { ...c, primary_group_id: primaryGroupId }
            : c,
        ),
      ),
    );
    syncFromServer();
  }

  async function handleAddPrimary(e: React.FormEvent) {
    e.preventDefault();
    const name = newPrimaryName.trim();
    if (!name) return;
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const slug = `c_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const nextOrder =
      primaryGroups.reduce((m, g) => Math.max(m, g.sort_order), -1) + 1;
    const { data, error: insErr } = await supabase
      .from("primary_category_groups")
      .insert({
        household_id: householdId,
        name,
        slug,
        color: newPrimaryColor,
        sort_order: nextOrder,
      })
      .select("id, name, slug, color, sort_order")
      .single();
    setLoading(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    if (data) {
      const row: PrimaryCategoryGroupRow = {
        id: String(data.id),
        name: String(data.name ?? ""),
        slug: String(data.slug ?? ""),
        color: data.color != null ? String(data.color) : null,
        sort_order: Number(data.sort_order ?? 0),
      };
      setPrimaryGroups(sortPrimaryGroups([...primaryGroups, row]));
      setNewPrimaryName("");
    }
    syncFromServer();
  }

  async function deletePrimaryGroup(g: PrimaryCategoryGroupRow) {
    if (isBuiltinPrimarySlug(g.slug)) {
      setError("Built-in primary groups cannot be deleted.");
      return;
    }
    const used = categories.filter((c) => c.primary_group_id === g.id).length;
    if (used > 0) {
      setError(
        `Reassign ${used} categor${used === 1 ? "y" : "ies"} before deleting this primary group.`,
      );
      return;
    }
    if (!globalThis.confirm(`Delete primary group “${g.name}”?`)) return;
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from("primary_category_groups")
      .delete()
      .eq("id", g.id)
      .eq("household_id", householdId);
    setLoading(false);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    setPrimaryGroups(primaryGroups.filter((x) => x.id !== g.id));
    syncFromServer();
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const nextOrder = maxSort + 1;
    const desc = newDescription.trim();
    const primaryId = newCategoryPrimaryId || purchasesGroupId;
    const parentId = newParentCategoryId.trim() || null;
    const parentRow = parentId
      ? categories.find((c) => c.id === parentId)
      : null;
    const { data, error: insertError } = await supabase
      .from("categories")
      .insert({
        household_id: householdId,
        name,
        color: newColor,
        sort_order: nextOrder,
        description: desc || null,
        primary_group_id: parentRow?.primary_group_id ?? primaryId,
        parent_category_id: parentId,
      })
      .select(
        "id, name, color, sort_order, description, primary_group_id, monthly_budget, parent_category_id, budget_repeats_annually, budget_active_from_month, budget_active_from_day, budget_active_to_month, budget_active_to_day, budget_period_start, budget_period_end, budget_amount_period, budget_annual_payment_month, budget_recurring_payment, budget_recurring_interval",
      )
      .single();

    setLoading(false);
    if (insertError) {
      if (
        insertError.code === "23505" ||
        insertError.message.toLowerCase().includes("duplicate")
      ) {
        setError("You already have a category with that name.");
      } else {
        setError(insertError.message);
      }
      return;
    }
    if (data) {
      setCategories(
        sortCategories([
          ...categories,
          mapCategoryRowFromSupabase(data),
        ]),
      );
      setNewName("");
      setNewDescription("");
      setNewParentCategoryId("");
    }
    syncFromServer();
  }

  function startEdit(c: CategoryRow) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditColor(c.color || "#6366f1");
    setEditDescription(c.description ?? "");
    setEditPrimaryGroupId(c.primary_group_id ?? purchasesGroupId);
    setEditParentCategoryId(c.parent_category_id ?? "");
    setError(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) return;
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const desc = editDescription.trim();
    const parentId = editParentCategoryId.trim() || null;
    const payload: Record<string, unknown> = {
      name,
      color: editColor,
      description: desc || null,
      parent_category_id: parentId,
    };
    if (!parentId) {
      payload.primary_group_id = editPrimaryGroupId;
    }
    const { error: updateError } = await supabase
      .from("categories")
      .update(payload)
      .eq("id", editingId)
      .eq("household_id", householdId);

    setLoading(false);
    if (updateError) {
      if (
        updateError.code === "23505" ||
        updateError.message.toLowerCase().includes("duplicate")
      ) {
        setError("You already have a category with that name.");
      } else {
        setError(updateError.message);
      }
      return;
    }
    setCategories(
      sortCategories(
        categories.map((c) => {
          if (c.id !== editingId) return c;
          const parentRow = parentId
            ? categories.find((x) => x.id === parentId)
            : null;
          return {
            ...c,
            name,
            color: editColor,
            description: desc || null,
            parent_category_id: parentId,
            primary_group_id: parentRow
              ? parentRow.primary_group_id
              : editPrimaryGroupId,
          };
        }),
      ),
    );
    setEditingId(null);
    syncFromServer();
  }

  function openDelete(c: CategoryRow) {
    setError(null);
    const subCount = categories.filter(
      (x) => x.parent_category_id === c.id,
    ).length;
    if (subCount > 0) {
      setError(
        `Delete the ${subCount} subcategor${subCount === 1 ? "y" : "ies"} under “${c.name}” first (or reassign their parent).`,
      );
      return;
    }
    setPendingDelete({ id: c.id, name: c.name });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    if (deleteMode === "move" && otherCategories.length > 0 && !moveToId) {
      setError("Choose a category to move transactions into.");
      return;
    }
    setError(null);
    setLoading(true);
    const supabase = createClient();

    if (deleteMode === "move" && otherCategories.length > 0) {
      const { error: u1 } = await supabase
        .from("transactions")
        .update({ category_id: moveToId })
        .eq("household_id", householdId)
        .eq("category_id", pendingDelete.id);
      if (u1) {
        setLoading(false);
        setError(u1.message);
        return;
      }
    } else {
      const { error: u2 } = await supabase
        .from("transactions")
        .update({ category_id: null })
        .eq("household_id", householdId)
        .eq("category_id", pendingDelete.id);
      if (u2) {
        setLoading(false);
        setError(u2.message);
        return;
      }
    }

    const { error: delError } = await supabase
      .from("categories")
      .delete()
      .eq("id", pendingDelete.id)
      .eq("household_id", householdId);

    setLoading(false);
    if (delError) {
      setError(delError.message);
      return;
    }

    setCategories(categories.filter((c) => c.id !== pendingDelete.id));
    if (editingId === pendingDelete.id) setEditingId(null);
    setPendingDelete(null);
    syncFromServer();
  }

  async function move(id: string, dir: -1 | 1) {
    const sorted = sortCategories(
      categories.filter((c) => !c.parent_category_id),
    );
    const i = sorted.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    const a = sorted[i];
    const b = sorted[j];
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: e1 } = await supabase
      .from("categories")
      .update({ sort_order: b.sort_order })
      .eq("id", a.id)
      .eq("household_id", householdId);
    const { error: e2 } = await supabase
      .from("categories")
      .update({ sort_order: a.sort_order })
      .eq("id", b.id)
      .eq("household_id", householdId);
    setLoading(false);
    if (e1 || e2) {
      setError((e1 || e2)!.message);
      return;
    }
    setCategories(
      sortCategories(
        categories.map((c) => {
          if (c.id === a.id) return { ...c, sort_order: b.sort_order };
          if (c.id === b.id) return { ...c, sort_order: a.sort_order };
          return c;
        }),
      ),
    );
    syncFromServer();
  }

  const titleClass = embedded
    ? "text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
    : "text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100";

  return (
    <div className={embedded ? "space-y-6" : "space-y-8"}>
      <div>
        {embedded ? (
          <h2 id="categories" className={titleClass}>
            Categories
          </h2>
        ) : (
          <h1 className={titleClass}>Categories</h1>
        )}
        <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
          Chase-style defaults are added automatically for new households (and
          any missing names are filled in when you open this page). Add notes
          under each category so you remember what belongs there.
        </p>
        <p className="mt-2 text-sm">
          <Link
            href="/settings/rules#category-rules"
            className="font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-300"
          >
            Categorization rules
          </Link>{" "}
          — match descriptions to categories for imports and new transactions.
        </p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            Subcategories
          </span>{" "}
          let you tag transactions under a parent (e.g.{" "}
          <span className="font-medium">Groceries › Snacks</span>). One level
          only; the primary group always matches the parent.
        </p>
      </div>

      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Primary categories (overview)
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Each ledger category belongs to one primary group. Overview shows{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">Income</span> vs{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">Purchases &amp; bills</span>{" "}
          on the first chart; <span className="font-medium dark:text-zinc-200">Bank transfers</span>{" "}
          and <span className="font-medium dark:text-zinc-200">Credit card payments</span> have
          their own charts. Add more primaries for custom rollups.
        </p>
        {primaryGroups.length === 0 ? (
          <p className="mt-3 text-sm text-amber-800 dark:text-amber-200">
            No primary groups found. Run the SQL migration{" "}
            <code className="rounded bg-amber-100/80 px-1 text-xs dark:bg-amber-950/80 dark:text-amber-100">
              20260409180000_primary_category_groups.sql
            </code>{" "}
            in Supabase, then refresh.
          </p>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-zinc-100 rounded-lg border border-zinc-100 dark:divide-zinc-800 dark:border-zinc-700 dark:bg-zinc-950/30">
              {sortPrimaryGroups(primaryGroups).map((g) => (
                <li
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: g.color || "#94a3b8" }}
                      aria-hidden
                    />
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{g.name}</span>
                    <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                      {g.slug}
                    </span>
                  </span>
                  {isBuiltinPrimarySlug(g.slug) ? (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">Built-in</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => deletePrimaryGroup(g)}
                      disabled={loading}
                      className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-40 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <form
              onSubmit={handleAddPrimary}
              className="mt-4 flex flex-col gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800 sm:flex-row sm:items-end"
            >
              <div className="flex-1">
                <label
                  htmlFor="primary-name"
                  className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                >
                  New primary name
                </label>
                <input
                  id="primary-name"
                  value={newPrimaryName}
                  onChange={(e) => setNewPrimaryName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                  placeholder="e.g. Investments"
                  maxLength={80}
                />
              </div>
              <div>
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Color</span>
                <input
                  type="color"
                  value={newPrimaryColor}
                  onChange={(e) => setNewPrimaryColor(e.target.value)}
                  className="mt-1 block h-10 w-14 cursor-pointer rounded border border-zinc-300 bg-white p-0.5 dark:border-zinc-600 dark:bg-zinc-800"
                  aria-label="Primary group color"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !newPrimaryName.trim()}
                className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                Add primary
              </button>
            </form>
          </>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">New category</h2>
        <form onSubmit={handleAdd} className="mt-4 space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="cat-name" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Name
              </label>
              <input
                id="cat-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                placeholder="e.g. Groceries"
                maxLength={80}
              />
            </div>
            <div>
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Color</span>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded border border-zinc-300 bg-white p-0.5 dark:border-zinc-600 dark:bg-zinc-800"
                  aria-label="Pick color"
                />
                <div className="flex flex-wrap gap-1">
                  {PRESET_COLORS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setNewColor(hex)}
                      className="h-7 w-7 rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: hex }}
                      aria-label={`Use color ${hex}`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || !newName.trim()}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Add
            </button>
          </div>
          <div>
            <label
              htmlFor="cat-parent-new"
              className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
            >
              Parent category (optional)
            </label>
            <select
              id="cat-parent-new"
              value={newParentCategoryId}
              onChange={(e) => setNewParentCategoryId(e.target.value)}
              className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
            >
              <option value="">Top-level category (no parent)</option>
              {topLevelCategories.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              Choose a parent to create a subcategory. Subcategories share the
              parent&apos;s primary group.
            </p>
          </div>
          {primaryGroups.length > 0 && !newParentCategoryId ? (
            <div>
              <label
                htmlFor="cat-primary-new"
                className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
              >
                Primary category
              </label>
              <select
                id="cat-primary-new"
                value={newCategoryPrimaryId || purchasesGroupId || ""}
                onChange={(e) => setNewCategoryPrimaryId(e.target.value || null)}
                className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
              >
                {sortPrimaryGroups(primaryGroups).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          ) : newParentCategoryId ? (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Primary group is taken from the parent category you selected.
            </p>
          ) : null}
          <div>
            <label
              htmlFor="cat-desc-new"
              className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
            >
              Description (optional)
            </label>
            <textarea
              id="cat-desc-new"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              maxLength={500}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
              placeholder="What kinds of transactions belong here?"
            />
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <div className="border-b border-zinc-100 px-6 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Your categories ({categories.length})
          </h2>
        </div>
        {categories.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No categories yet. Add one above.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sortCategoriesForPicker(categories).map((c) => {
              const ti = c.parent_category_id
                ? -1
                : topLevelSorted.findIndex((x) => x.id === c.id);
              return (
              <li
                key={c.id}
                className={`px-6 py-4 ${c.parent_category_id ? "border-l-2 border-violet-200 pl-5 dark:border-violet-900/50" : ""}`}
              >
                {editingId === c.id ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm sm:max-w-xs dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                        maxLength={80}
                      />
                      <input
                        type="color"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        className="h-10 w-14 cursor-pointer rounded border border-zinc-300 bg-white p-0.5 dark:border-zinc-600 dark:bg-zinc-800"
                        aria-label="Edit color"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={loading || !editName.trim()}
                          className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        Description (optional)
                      </label>
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        rows={2}
                        maxLength={500}
                        className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`edit-parent-${editingId}`}
                        className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                      >
                        Parent category
                      </label>
                      <select
                        id={`edit-parent-${editingId}`}
                        value={editParentCategoryId}
                        onChange={(e) => setEditParentCategoryId(e.target.value)}
                        className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                      >
                        <option value="">Top-level (no parent)</option>
                        {topLevelCategories
                          .filter((p) => p.id !== editingId)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    {primaryGroups.length > 0 && !editParentCategoryId ? (
                      <div>
                        <label
                          htmlFor={`edit-primary-${editingId}`}
                          className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                        >
                          Primary category
                        </label>
                        <select
                          id={`edit-primary-${editingId}`}
                          value={editPrimaryGroupId || purchasesGroupId || ""}
                          onChange={(e) =>
                            setEditPrimaryGroupId(e.target.value || null)
                          }
                          className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                        >
                          {sortPrimaryGroups(primaryGroups).map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : editParentCategoryId ? (
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">
                        Primary group matches the parent category.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10"
                          style={{ backgroundColor: c.color || "#94a3b8" }}
                          aria-hidden
                        />
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {formatCategoryLabel(c, categories)}
                        </span>
                      </div>
                      {c.description ? (
                        <p className="mt-2 pl-7 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                          {c.description}
                        </p>
                      ) : null}
                      {primaryGroups.length > 0 ? (
                        <div className="mt-3 pl-7">
                          <label
                            className="text-xs font-medium text-zinc-500 dark:text-zinc-400"
                            htmlFor={`primary-inline-${c.id}`}
                          >
                            Primary
                          </label>
                          <select
                            id={`primary-inline-${c.id}`}
                            disabled={loading || !!c.parent_category_id}
                            value={primarySelectValue(c)}
                            onChange={(e) =>
                              patchCategoryPrimary(c.id, e.target.value)
                            }
                            className="mt-1 block w-full max-w-xs rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
                          >
                            {sortPrimaryGroups(primaryGroups).map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => move(c.id, -1)}
                        disabled={
                          loading ||
                          !!c.parent_category_id ||
                          ti <= 0
                        }
                        className="rounded-lg border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        aria-label="Move up"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => move(c.id, 1)}
                        disabled={
                          loading ||
                          !!c.parent_category_id ||
                          ti < 0 ||
                          ti >= topLevelSorted.length - 1
                        }
                        className="rounded-lg border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        aria-label="Move down"
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => openDelete(c)}
                        disabled={loading}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
            })}
          </ul>
        )}
      </section>

      {pendingDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-cat-title"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40">
            <h3
              id="delete-cat-title"
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Delete “{pendingDelete.name}”?
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Choose what happens to transactions that are currently in this
              category.
            </p>

            {otherCategories.length > 0 ? (
              <div className="mt-4 space-y-3">
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 has-[:checked]:border-zinc-400 has-[:checked]:bg-zinc-50 dark:border-zinc-700 dark:has-[:checked]:border-zinc-500 dark:has-[:checked]:bg-zinc-800/60">
                  <input
                    type="radio"
                    name="del-mode"
                    checked={deleteMode === "move"}
                    onChange={() => setDeleteMode("move")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      Move to another category
                    </span>
                    <select
                      value={moveToId}
                      onChange={(e) => setMoveToId(e.target.value)}
                      disabled={deleteMode !== "move"}
                      className="mt-2 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                    >
                      {otherCategories.map((o) => (
                        <option key={o.id} value={o.id}>
                          {formatCategoryLabel(o, categories)}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 has-[:checked]:border-zinc-400 has-[:checked]:bg-zinc-50 dark:border-zinc-700 dark:has-[:checked]:border-zinc-500 dark:has-[:checked]:bg-zinc-800/60">
                  <input
                    type="radio"
                    name="del-mode"
                    checked={deleteMode === "clear"}
                    onChange={() => setDeleteMode("clear")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      Leave uncategorized
                    </span>
                    <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">
                      Transactions stay in your ledger with no category label.
                    </span>
                  </span>
                </label>
              </div>
            ) : (
              <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
                This is your only category. Transactions will become
                uncategorized.
              </p>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setPendingDelete(null);
                  setError(null);
                }}
                className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={loading}
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600"
              >
                {loading ? "Working…" : "Delete category"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
