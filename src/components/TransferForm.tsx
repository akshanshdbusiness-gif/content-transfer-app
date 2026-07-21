"use client";

import { useState } from "react";
import {
  MERGE_STRATEGIES,
  type EnvironmentOption,
  type TransferRequest,
} from "@/src/lib/types";

interface TransferFormProps {
  environments: EnvironmentOption[];
  submitting: boolean;
  onSubmit: (request: TransferRequest) => void;
  /** Optional Authoring GraphQL check that a path exists on the source. */
  onValidatePath?: (
    path: string,
    sourceEnvironment: string,
  ) => Promise<string | null>;
}

const MERGE_STRATEGY_HINTS: Record<string, string> = {
  OverrideExistingItem: "Replace items that already exist in the target",
  KeepExistingItem: "Skip items that already exist in the target",
  LatestWin: "Keep whichever version was modified most recently",
  OverrideExistingTree: "Replace the whole target tree with the source tree",
};

// Package Designer style: each row is an item, transferred with or without
// its children.
interface ItemRow {
  itemPath: string;
  withChildren: boolean;
  check: string | null;
  checkPassed: boolean;
  checking: boolean;
}

const emptyRow = (): ItemRow => ({
  itemPath: "/sitecore/content/",
  withChildren: true,
  check: null,
  checkPassed: false,
  checking: false,
});

export function TransferForm({
  environments,
  submitting,
  onSubmit,
  onValidatePath,
}: TransferFormProps) {
  const [items, setItems] = useState<ItemRow[]>([emptyRow()]);
  const [mergeStrategy, setMergeStrategy] = useState<
    TransferRequest["mergeStrategy"]
  >("OverrideExistingItem");
  const [sourceEnvironment, setSourceEnvironment] = useState(
    environments[0]?.value ?? "",
  );
  const [targetEnvironment, setTargetEnvironment] = useState(
    environments[1]?.value ?? "",
  );

  const updateItem = (index: number, patch: Partial<ItemRow>) =>
    setItems((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  const canSubmit =
    !submitting &&
    items.length > 0 &&
    items.every((row) => row.itemPath.trim().startsWith("/sitecore/")) &&
    sourceEnvironment &&
    targetEnvironment &&
    sourceEnvironment !== targetEnvironment;

  // New rows may only be added once every current row's check has passed
  // (when no validator is available, don't block).
  const canAddItem = !onValidatePath || items.every((row) => row.checkPassed);

  const handleValidate = async (index: number) => {
    if (!onValidatePath) return;
    updateItem(index, { checking: true, check: null, checkPassed: false });
    try {
      const result = await onValidatePath(
        items[index].itemPath.trim(),
        sourceEnvironment,
      );
      updateItem(index, {
        check: result,
        checkPassed: result?.startsWith("✓") ?? false,
      });
    } finally {
      updateItem(index, { checking: false });
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          items: items.map((row) => ({
            itemPath: row.itemPath.trim(),
            scope: row.withChildren ? "ItemAndDescendants" : "SingleItem",
          })),
          mergeStrategy,
          // XM Cloud / SitecoreAI authoring content always lives in master.
          database: "master",
          sourceEnvironment,
          targetEnvironment,
        });
      }}
    >
      <div className="row">
        <label>
          Source environment
          <select
            value={sourceEnvironment}
            onChange={(e) => {
              setSourceEnvironment(e.target.value);
              // Checks were made against the previous source — reset them.
              setItems((rows) =>
                rows.map((row) => ({
                  ...row,
                  check: null,
                  checkPassed: false,
                })),
              );
            }}
            required
          >
            {environments.map((env) => (
              <option key={env.value} value={env.value}>
                {env.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Target environment
          <select
            value={targetEnvironment}
            onChange={(e) => setTargetEnvironment(e.target.value)}
            required
          >
            <option value="">Select…</option>
            {environments
              .filter((env) => env.value !== sourceEnvironment)
              .map((env) => (
                <option key={env.value} value={env.value}>
                  {env.label}
                </option>
              ))}
          </select>
        </label>
      </div>

      <fieldset className="items">
        <legend>Items to transfer</legend>
        {items.map((row, index) => (
          <div className="item-row" key={index}>
            <div className="item-main">
              <input
                type="text"
                value={row.itemPath}
                onChange={(e) =>
                  updateItem(index, {
                    itemPath: e.target.value,
                    check: null,
                    checkPassed: false,
                  })
                }
                placeholder="/sitecore/content/MySite/Home"
                required
              />
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={row.withChildren}
                  onChange={(e) =>
                    updateItem(index, { withChildren: e.target.checked })
                  }
                />
                Include subitems
              </label>
              {onValidatePath && (
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => handleValidate(index)}
                  disabled={
                    row.checking ||
                    !row.itemPath.trim().startsWith("/sitecore/")
                  }
                >
                  {row.checking ? "Checking…" : "Check"}
                </button>
              )}
              {items.length > 1 && (
                <button
                  type="button"
                  className="secondary small"
                  onClick={() =>
                    setItems((rows) => rows.filter((_, i) => i !== index))
                  }
                  aria-label="Remove item"
                >
                  ✕
                </button>
              )}
            </div>
            {row.check && (
              <span className={row.checkPassed ? "check-ok" : "check-err"}>
                {row.check}
              </span>
            )}
          </div>
        ))}
        <button
          type="button"
          className="secondary small"
          onClick={() => setItems((rows) => [...rows, emptyRow()])}
          disabled={!canAddItem}
          title={
            canAddItem
              ? undefined
              : "Check every item on the source before adding another"
          }
        >
          + Add item
        </button>
        {!canAddItem && (
          <span className="hint">
            Check every item on the source before adding another
          </span>
        )}
      </fieldset>

      <label>
        Merge strategy
        <select
          value={mergeStrategy}
          onChange={(e) =>
            setMergeStrategy(e.target.value as TransferRequest["mergeStrategy"])
          }
        >
          {MERGE_STRATEGIES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="hint">{MERGE_STRATEGY_HINTS[mergeStrategy]}</span>
      </label>

      <button type="submit" disabled={!canSubmit}>
        {submitting
          ? "Transferring…"
          : `Start transfer (${items.length} item${items.length === 1 ? "" : "s"})`}
      </button>
    </form>
  );
}
