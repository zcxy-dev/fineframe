"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectSummary } from "../lib/jobs.ts";
import { FOOTAGE_KEPT } from "../lib/retention.ts";
import { formatBytes, formatLength } from "../lib/settings.ts";
import { ErrorNote } from "./ErrorNote.tsx";
import styles from "./editor.module.css";
import { useT } from "./I18n.tsx";
import { FilmIcon } from "./icons.tsx";

/** Earlier edits, to open again or delete, with the disk space each takes. */
export function Projects({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useT();
  const words = t.projects;
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The project whose Delete was clicked once, asking for a second click.
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetch("/api/jobs")
      .then((response) => response.json() as Promise<ProjectSummary[]>)
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!deleting) return;
    const timer = setTimeout(() => setDeleting(null), 4000);
    return () => clearTimeout(timer);
  }, [deleting]);

  const remove = async (id: string) => {
    setDeleting(null);
    const response = await fetch(`/api/jobs/${id}/remove`, { method: "POST" });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? words.notDeleted);
    } else setError(null);
    load();
  };

  const shown = projects?.filter((project) => project.status !== "uploading") ?? [];
  if (shown.length === 0) return null;
  const total = shown.reduce((sum, project) => sum + project.bytes, 0);
  return (
    <section className={`${styles.card} ${styles.files}`} aria-label={words.title}>
      <div className={styles.filesHead}>
        <div>
          <h2 className={styles.filesTitle}>{words.title}</h2>
          <p className={styles.filesMeta}>
            {words.meta(shown.length, formatBytes(total), FOOTAGE_KEPT)}
          </p>
        </div>
      </div>
      {error && <ErrorNote message={error} fallback={words.fallback} />}
      <ul className={styles.fileList}>
        {shown.map((project) => (
          <li key={project.id} className={styles.project}>
            <span className={styles.fileIcon}>
              <FilmIcon />
            </span>
            <span className={styles.fileText}>
              <span className={styles.fileName} title={project.name}>
                {project.name || words.untitled}
              </span>
              <span className={styles.fileMeta}>
                {t.date(project.created)} · {formatLength(project.length, t)} · {project.aspect} ·{" "}
                {words.status[project.status]} · {formatBytes(project.bytes)}
                {project.status === "done" && !project.footage && words.footageRemoved}
              </span>
            </span>
            <button type="button" className={styles.button} onClick={() => onOpen(project.id)}>
              {words.open}
            </button>
            <button
              type="button"
              className={
                deleting === project.id ? `${styles.button} ${styles.danger}` : styles.button
              }
              disabled={project.status === "running"}
              onClick={() =>
                deleting === project.id ? void remove(project.id) : setDeleting(project.id)
              }
            >
              {deleting === project.id ? words.sure : words.delete}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
