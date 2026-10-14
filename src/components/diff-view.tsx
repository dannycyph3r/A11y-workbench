"use client";

import { useMemo } from "react";
import { buildDiffRows, diffStats, type DiffRow, type DiffSide } from "@/lib/remediation/diff";

function SideText({ side }: { side: DiffSide }) {
  return (
    <>
      {side.truncatedStart ? <span className="elide">… </span> : null}
      {side.before}
      {side.changed ? <mark>{side.changed}</mark> : null}
      {side.after}
      {side.truncatedEnd ? <span className="elide"> …</span> : null}
    </>
  );
}

/** Real line diff between two texts, side by side or unified, rendered as a table. */
export function DiffView({ before, after, mode, caption }: { before: string; after: string; mode: "split" | "unified"; caption: string }) {
  const rows = useMemo(() => buildDiffRows(before, after), [before, after]);
  const stats = diffStats(rows);

  if (stats.added === 0 && stats.removed === 0) {
    return <p className="rounded border border-dashed border-line-control p-4 text-sm text-ink-2">No changes. The proposed text is identical to the original.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-control)] border border-line bg-surface" role="region" aria-label={caption} tabIndex={0}>
      <table className="diff">
        <caption className="sr-only">
          {caption}: {stats.removed} line{stats.removed === 1 ? "" : "s"} removed, {stats.added} added. Removed text is marked as deleted and added text as inserted.
        </caption>
        {mode === "split" ? (
          <colgroup>
            <col className="w-14" />
            <col className="w-5" />
            <col />
            <col className="w-14" />
            <col className="w-5" />
            <col />
          </colgroup>
        ) : (
          <colgroup>
            <col className="w-14" />
            <col className="w-14" />
            <col className="w-5" />
            <col />
          </colgroup>
        )}
        <thead className="sr-only">
          {mode === "split" ? (
            <tr><th scope="col">Original line</th><th scope="col">Change</th><th scope="col">Original</th><th scope="col">Proposed line</th><th scope="col">Change</th><th scope="col">Proposed</th></tr>
          ) : (
            <tr><th scope="col">Original line</th><th scope="col">Proposed line</th><th scope="col">Change</th><th scope="col">Text</th></tr>
          )}
        </thead>
        <tbody>{mode === "split" ? rows.map((r, i) => <SplitRow key={i} row={r} />) : rows.flatMap((r, i) => unifiedRows(r, i))}</tbody>
      </table>
    </div>
  );
}

function SplitRow({ row }: { row: DiffRow }) {
  if (row.kind === "fold") {
    return (
      <tr className="fold">
        <td colSpan={6}>{row.count} unchanged line{row.count === 1 ? "" : "s"}</td>
      </tr>
    );
  }
  if (row.kind === "context") {
    return (
      <tr>
        <td className="ln">{row.left.lineNo}</td>
        <td className="sign" />
        <td><SideText side={row.left} /></td>
        <td className="ln">{row.right.lineNo}</td>
        <td className="sign" />
        <td><SideText side={row.right} /></td>
      </tr>
    );
  }
  return (
    <tr>
      <td className={`ln ${row.left ? "del" : ""}`}>{row.left?.lineNo ?? ""}</td>
      <td className={`sign ${row.left ? "del" : ""}`}>{row.left ? <><span aria-hidden="true">-</span><span className="sr-only">removed</span></> : null}</td>
      <td className={row.left ? "del" : ""}>{row.left ? <del className="no-underline"><SideText side={row.left} /></del> : null}</td>
      <td className={`ln ${row.right ? "add" : ""}`}>{row.right?.lineNo ?? ""}</td>
      <td className={`sign ${row.right ? "add" : ""}`}>{row.right ? <><span aria-hidden="true">+</span><span className="sr-only">added</span></> : null}</td>
      <td className={row.right ? "add" : ""}>{row.right ? <ins className="no-underline"><SideText side={row.right} /></ins> : null}</td>
    </tr>
  );
}

function unifiedRows(row: DiffRow, i: number) {
  if (row.kind === "fold") {
    return [
      <tr key={i} className="fold">
        <td colSpan={4}>{row.count} unchanged line{row.count === 1 ? "" : "s"}</td>
      </tr>,
    ];
  }
  if (row.kind === "context") {
    return [
      <tr key={i}>
        <td className="ln">{row.left.lineNo}</td>
        <td className="ln">{row.right.lineNo}</td>
        <td className="sign" />
        <td><SideText side={row.left} /></td>
      </tr>,
    ];
  }
  const out = [];
  if (row.left)
    out.push(
      <tr key={`${i}-l`} className="del">
        <td className="ln">{row.left.lineNo}</td>
        <td className="ln" />
        <td className="sign"><span aria-hidden="true">-</span><span className="sr-only">removed</span></td>
        <td><del className="no-underline"><SideText side={row.left} /></del></td>
      </tr>,
    );
  if (row.right)
    out.push(
      <tr key={`${i}-r`} className="add">
        <td className="ln" />
        <td className="ln">{row.right.lineNo}</td>
        <td className="sign"><span aria-hidden="true">+</span><span className="sr-only">added</span></td>
        <td><ins className="no-underline"><SideText side={row.right} /></ins></td>
      </tr>,
    );
  return out;
}
