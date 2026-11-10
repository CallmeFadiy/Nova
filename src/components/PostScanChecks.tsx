import { useEffect, useRef, useState } from "react";
import { api } from "../lib/tauri";
import { pluralRu } from "../lib/format";
import { useUiStore } from "../store/ui";
import type { TagEncodingIssue } from "../types";
import {
  findDuplicateGroups,
  useLibraryStore,
  type DuplicateTrackGroup,
} from "../store/library";
import { DuplicateTracksModal } from "./DuplicateTracksModal";
import { EncodingFixModal } from "./EncodingFixModal";

/**
 * Runs the library hygiene checks after every scan: missing records are
 * removed with a toast, while duplicates and tag-encoding issues open their
 * preview modals. Nothing is deleted from the disk without confirmation.
 */
export function PostScanChecks() {
  const lastScan = useLibraryStore((state) => state.lastScan);
  const deleteMissingTracks = useLibraryStore(
    (state) => state.deleteMissingTracks,
  );
  const deleteTracks = useLibraryStore((state) => state.deleteTracks);
  const applyTagEncoding = useLibraryStore(
    (state) => state.applyTagEncoding,
  );
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateTrackGroup[]>(
    [],
  );
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [encodingIssues, setEncodingIssues] = useState<TagEncodingIssue[]>([]);
  const [encodingOpen, setEncodingOpen] = useState(false);
  const [encodingBusy, setEncodingBusy] = useState(false);
  const handled = useRef<unknown>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const win = window as unknown as {
      __novaShowDuplicates?: (groups: DuplicateTrackGroup[]) => void;
    };
    win.__novaShowDuplicates = (groups) => {
      setDuplicateGroups(groups);
      setDuplicateOpen(true);
    };
    return () => {
      delete win.__novaShowDuplicates;
    };
  }, []);

  useEffect(() => {
    if (!lastScan || handled.current === lastScan) return;
    handled.current = lastScan;
    let cancelled = false;

    const run = async () => {
      const missing = useLibraryStore
        .getState()
        .tracks.filter((track) => track.missing);
      if (missing.length > 0) {
        await deleteMissingTracks();
      }

      const candidates = findDuplicateGroups(useLibraryStore.getState().tracks);
      if (candidates.length > 0) {
        try {
          const hashes = await api.hashTracks(
            candidates.flatMap((group) =>
              group.tracks.map((track) => track.id),
            ),
          );
          const groups = findDuplicateGroups(
            useLibraryStore.getState().tracks,
            hashes,
          );
          if (!cancelled && groups.length > 0) {
            setDuplicateGroups(groups);
            useUiStore.getState().notify(
              `Найдены дубликаты: ${groups.length} ${pluralRu(groups.length, [
                "группа",
                "группы",
                "групп",
              ])}`,
              "info",
              {
                label: "Открыть",
                onClick: () => setDuplicateOpen(true),
              },
            );
          }
        } catch {
          // The scan itself succeeded; a duplicate check must not fail it.
        }
      }

      try {
        const issues = await api.previewTagEncoding();
        if (!cancelled && issues.length > 0) {
          setEncodingIssues(issues);
          setEncodingOpen(true);
        }
      } catch {
        // Same as above: encoding preview is best-effort.
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [lastScan, deleteMissingTracks]);

  return (
    <>
      <DuplicateTracksModal
        open={duplicateOpen}
        groups={duplicateGroups}
        busy={duplicateBusy}
        onClose={() => setDuplicateOpen(false)}
        onConfirm={(ids) => {
          if (ids.length === 0) return;
          setDuplicateBusy(true);
          void deleteTracks(ids, true).then((result) => {
            setDuplicateBusy(false);
            if (result) {
              setDuplicateOpen(false);
              setDuplicateGroups([]);
            }
          });
        }}
      />

      <EncodingFixModal
        open={encodingOpen}
        issues={encodingIssues}
        busy={encodingBusy}
        onClose={() => setEncodingOpen(false)}
        onConfirm={() => {
          setEncodingBusy(true);
          void applyTagEncoding().then((fixed) => {
            setEncodingBusy(false);
            if (fixed !== null) {
              setEncodingOpen(false);
              setEncodingIssues([]);
            }
          });
        }}
      />
    </>
  );
}
