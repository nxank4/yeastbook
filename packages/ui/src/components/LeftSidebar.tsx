import { useState, useMemo, useCallback, useEffect } from "react";
import type { Cell, VariableDetails } from "@codepawl/yeastbook-core";
import { useTableOfContents } from "../hooks/useTableOfContents.ts";
import { useActiveCellObserver } from "../hooks/useActiveCellObserver.ts";
import { TableOfContents } from "./TableOfContents.tsx";
import { VariableExplorer } from "./VariableExplorer.tsx";
import { EnvExplorer } from "./EnvExplorer.tsx";
import { DependenciesPanel } from "./DependenciesPanel.tsx";
import { ResourceMonitor } from "./ResourceMonitor.tsx";
import { FileExplorer } from "./FileExplorer.tsx";

interface VariableEntry {
  value: unknown;
  type: string;
  serializable: boolean;
}

interface Props {
  cells: Cell[];
  variables: Record<string, VariableEntry>;
  dependencies: Record<string, string>;
  inspectionResults?: Map<string, VariableDetails>;
  onInspectVariable?: (name: string) => void;
  onScrollToCell: (cellId: string) => void;
  onOpenNotebook: (path: string) => void;
  fileTreeRefresh: number;
  performanceMode?: boolean;
  onSuggestPerfMode?: () => void;
}

type TabId = "files" | "toc" | "variables" | "resources" | "env";

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: "files", icon: "bi bi-files", label: "Explorer" },
  { id: "toc", icon: "bi bi-list-nested", label: "Table of Contents" },
  { id: "variables", icon: "bi bi-braces", label: "Variables" },
  { id: "resources", icon: "bi bi-speedometer2", label: "Resources" },
  { id: "env", icon: "bi bi-key", label: "Environment" },
];

function getStoredTab(): TabId {
  const v = localStorage.getItem("yeastbook-sidebar-tab");
  if (TABS.some((t) => t.id === v)) return v as TabId;
  return "files";
}

function getStoredExpanded(): boolean {
  return localStorage.getItem("yeastbook-sidebar-expanded") === "true";
}

export function LeftSidebar({
  cells, variables, dependencies, inspectionResults, onInspectVariable,
  onScrollToCell, onOpenNotebook, fileTreeRefresh, performanceMode, onSuggestPerfMode,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>(getStoredTab);
  const [expanded, setExpanded] = useState(getStoredExpanded);
  const [glowing, setGlowing] = useState(false);

  const tocEntries = useTableOfContents(cells);
  const cellIds = useMemo(() => cells.map((c) => c.id), [cells]);
  const activeCellId = useActiveCellObserver(cellIds);

  // Listen for Ctrl+B toggle from app
  useEffect(() => {
    const handler = () => {
      setExpanded((prev) => {
        const next = !prev;
        localStorage.setItem("yeastbook-sidebar-expanded", String(next));
        return next;
      });
    };
    window.addEventListener("yeastbook-toggle-sidebar", handler);

    // Force-open to files tab (e.g., from welcome screen)
    const openFilesHandler = () => {
      setActiveTab("files");
      setExpanded(true);
      localStorage.setItem("yeastbook-sidebar-expanded", "true");
      localStorage.setItem("yeastbook-sidebar-tab", "files");
      setGlowing(true);
      setTimeout(() => setGlowing(false), 1500);
    };
    window.addEventListener("yeastbook-open-files", openFilesHandler);

    // Open a specific sidebar tab by name
    const openTabHandler = (e: Event) => {
      const tabId = (e as CustomEvent).detail as TabId;
      if (TABS.some((t) => t.id === tabId)) {
        setActiveTab(tabId);
        setExpanded(true);
        localStorage.setItem("yeastbook-sidebar-expanded", "true");
        localStorage.setItem("yeastbook-sidebar-tab", tabId);
        setGlowing(true);
        setTimeout(() => setGlowing(false), 1500);
      }
    };
    window.addEventListener("yeastbook-open-tab", openTabHandler);

    return () => {
      window.removeEventListener("yeastbook-toggle-sidebar", handler);
      window.removeEventListener("yeastbook-open-files", openFilesHandler);
      window.removeEventListener("yeastbook-open-tab", openTabHandler);
    };
  }, []);

  const handleTabClick = useCallback((tabId: TabId) => {
    if (tabId === activeTab && expanded) {
      setExpanded(false);
      localStorage.setItem("yeastbook-sidebar-expanded", "false");
    } else {
      setActiveTab(tabId);
      setExpanded(true);
      localStorage.setItem("yeastbook-sidebar-tab", tabId);
      localStorage.setItem("yeastbook-sidebar-expanded", "true");
    }
  }, [activeTab, expanded]);

  const handleClose = useCallback(() => {
    setExpanded(false);
    localStorage.setItem("yeastbook-sidebar-expanded", "false");
  }, []);

  return (
    <div className="left-sidebar">
      <div className="left-sidebar-icons">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`left-sidebar-icon ${activeTab === tab.id && expanded ? "active" : ""}`}
            onClick={() => handleTabClick(tab.id)}
            title={tab.label}
          >
            <i className={tab.icon} />
          </button>
        ))}
      </div>
      {expanded && (
        <div className={`left-sidebar-panel ${glowing ? "sidebar-glow" : ""}`}>
          {activeTab === "files" && (
            <FileExplorer
              onOpenNotebook={onOpenNotebook}
              onClose={handleClose}
              refreshTrigger={fileTreeRefresh}
            />
          )}
          {activeTab === "toc" && (
            <>
              <div className="sidebar-left-header">
                <span className="sidebar-left-title">TABLE OF CONTENTS</span>
                <div style={{ flex: 1 }} />
                <button className="sidebar-left-action" title="Close" onClick={handleClose}>
                  <i className="bi bi-x-lg" />
                </button>
              </div>
              <div className="left-sidebar-scroll">
                <TableOfContents entries={tocEntries} activeCellId={activeCellId} onNavigate={onScrollToCell} />
              </div>
            </>
          )}
          {activeTab === "variables" && (
            <>
              <div className="sidebar-left-header">
                <span className="sidebar-left-title">VARIABLES</span>
                <div style={{ flex: 1 }} />
                <button className="sidebar-left-action" title="Close" onClick={handleClose}>
                  <i className="bi bi-x-lg" />
                </button>
              </div>
              <div className="left-sidebar-scroll">
                <VariableExplorer variables={variables} onInspect={onInspectVariable} inspectionResults={inspectionResults} />
              </div>
            </>
          )}
          {activeTab === "resources" && (
            <>
              <div className="sidebar-left-header">
                <span className="sidebar-left-title">RESOURCES</span>
                <div style={{ flex: 1 }} />
                <button className="sidebar-left-action" title="Close" onClick={handleClose}>
                  <i className="bi bi-x-lg" />
                </button>
              </div>
              <div className="left-sidebar-scroll">
                <ResourceMonitor performanceMode={performanceMode} onSuggestPerfMode={onSuggestPerfMode} />
              </div>
            </>
          )}
          {activeTab === "env" && (
            <>
              <div className="sidebar-left-header">
                <span className="sidebar-left-title">ENVIRONMENT</span>
                <div style={{ flex: 1 }} />
                <button className="sidebar-left-action" title="Close" onClick={handleClose}>
                  <i className="bi bi-x-lg" />
                </button>
              </div>
              <div className="left-sidebar-scroll">
                <EnvExplorer />
                <DependenciesPanel dependencies={dependencies} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
