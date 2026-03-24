import { useState, useMemo, useCallback } from "react";
import type { Cell, VariableDetails } from "@codepawl/yeastbook-core";
import { useTableOfContents } from "../hooks/useTableOfContents.ts";
import { useActiveCellObserver } from "../hooks/useActiveCellObserver.ts";
import { TableOfContents } from "./TableOfContents.tsx";
import { VariableExplorer } from "./VariableExplorer.tsx";
import { EnvExplorer } from "./EnvExplorer.tsx";
import { DependenciesPanel } from "./DependenciesPanel.tsx";
import { ResourceMonitor } from "./ResourceMonitor.tsx";

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
}

type TabId = "toc" | "variables" | "resources" | "env";

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: "toc", icon: "bi bi-list-nested", label: "Table of Contents" },
  { id: "variables", icon: "bi bi-braces", label: "Variables" },
  { id: "resources", icon: "bi bi-speedometer2", label: "Resources" },
  { id: "env", icon: "bi bi-key", label: "Environment" },
];

function getStoredTab(): TabId {
  const v = localStorage.getItem("yeastbook-sidebar-tab");
  if (v === "toc" || v === "variables" || v === "resources" || v === "env") return v;
  return "toc";
}

function getStoredExpanded(): boolean {
  return localStorage.getItem("yeastbook-sidebar-expanded") !== "false";
}

export function RightSidebar({ cells, variables, dependencies, inspectionResults, onInspectVariable, onScrollToCell }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>(getStoredTab);
  const [expanded, setExpanded] = useState(getStoredExpanded);

  const tocEntries = useTableOfContents(cells);
  const cellIds = useMemo(() => cells.map((c) => c.id), [cells]);
  const activeCellId = useActiveCellObserver(cellIds);

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

  return (
    <div className={`notebook-sidebar ${expanded ? "" : "collapsed"}`}>
      <div className="sidebar-tab-strip">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`sidebar-tab-btn ${activeTab === tab.id && expanded ? "active" : ""}`}
            onClick={() => handleTabClick(tab.id)}
            title={tab.label}
          >
            <i className={tab.icon} />
          </button>
        ))}
      </div>
      {expanded && (
        <div className="sidebar-content">
          {activeTab === "toc" && (
            <>
              <div className="sidebar-section-title">TABLE OF CONTENTS</div>
              <TableOfContents entries={tocEntries} activeCellId={activeCellId} onNavigate={onScrollToCell} />
            </>
          )}
          {activeTab === "variables" && (
            <>
              <div className="sidebar-section-title">VARIABLES</div>
              <VariableExplorer variables={variables} onInspect={onInspectVariable} inspectionResults={inspectionResults} />
            </>
          )}
          {activeTab === "resources" && (
            <>
              <div className="sidebar-section-title">RESOURCES</div>
              <ResourceMonitor />
            </>
          )}
          {activeTab === "env" && (
            <>
              <EnvExplorer />
              <DependenciesPanel dependencies={dependencies} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
