"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectSummary } from "../lib/jobs.ts";
import { FOOTAGE_KEPT } from "../lib/retention.ts";
import { formatBytes, formatLength } from "../lib/settings.ts";
import styles from "./editor.module.css";
import { FilmIcon } from "./icons.tsx";

const STATUS: Record<ProjectSummary["status"], string> = {
  uploading: "Not started",
  running: "Running",
  done: "Done",
  error: "Failed",
  cancelled: "Cancelled",
};

/** Earlier edits, to open again or delete, with the disk space each takes. */
export function Projects({ onOpen }: { onOpen: (id: string) => void }) {
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
      setError(body.error ?? "The project could not be deleted");
    } else setError(null);
    load();
  };

  const shown = projects?.filter((project) => project.status !== "uploading") ?? [];
  if (shown.length === 0) return null;
  const total = shown.reduce((sum, project) => sum + project.bytes, 0);
  return (
    <section className={`${styles.card} ${styles.files}`} aria-label="Projects">
      <div className={styles.filesHead}>
        <div>
          <h2 className={styles.filesTitle}>Projects</h2>
          <p className={styles.filesMeta}>
            {shown.length} {shown.length === 1 ? "project" : "projects"} · {formatBytes(total)} on
            disk · the newest {FOOTAGE_KEPT} keep their footage for editing again
          </p>
        </div>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <ul className={styles.fileList}>
        {shown.map((project) => (
          <li key={project.id} className={styles.project}>
            <span className={styles.fileIcon}>
              <FilmIcon />
            </span>
            <span className={styles.fileText}>
              <span className={styles.fileName} title={project.name}>
                {project.name || "Untitled"}
              </span>
              <span className={styles.fileMeta}>
                {new Date(project.created).toLocaleString()} · {formatLength(project.length)} ·{" "}
                {project.aspect} · {STATUS[project.status]} · {formatBytes(project.bytes)}
                {project.status === "done" && !project.footage && " · footage removed"}
              </span>
            </span>
            <button type="button" className={styles.button} onClick={() => onOpen(project.id)}>
              Open
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
              {deleting === project.id ? "Delete? Click again" : "Delete"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
