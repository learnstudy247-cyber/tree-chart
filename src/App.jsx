import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  NodeResizer,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  addEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./App.css";

import { toPng } from "html-to-image";
import jsPDF from "jspdf";

const STORAGE_KEY = "vismay-tree-chart-v2";

const NODE_WIDTH = 240;
const X_GAP = 310;
const Y_GAP = 260;

const BOX_SHAPES = [
  { value: "rounded", label: "Rounded Rectangle" },
  { value: "square", label: "Square Rectangle" },
  { value: "extra-rounded", label: "Extra Rounded" },
  { value: "pill", label: "Pill / Capsule" },
  { value: "oval", label: "Oval" },
  { value: "circle", label: "Circle" },
  { value: "diamond", label: "Diamond" },
  { value: "hexagon", label: "Hexagon" },
  { value: "parallelogram", label: "Parallelogram" },
];

function getShapeStyle(shape = "rounded") {
  switch (shape) {
    case "square":
      return { borderRadius: "2px" };
    case "extra-rounded":
      return { borderRadius: "28px" };
    case "pill":
      return { borderRadius: "999px" };
    case "oval":
      return { borderRadius: "50%" };
    case "circle":
      return { borderRadius: "50%", width: "240px", minHeight: "240px" };
    case "diamond":
      return { clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)", padding: "34px" };
    case "hexagon":
      return { clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)", padding: "22px 28px" };
    case "parallelogram":
      return { clipPath: "polygon(12% 0%, 100% 0%, 88% 100%, 0% 100%)", padding: "14px 28px" };
    default:
      return { borderRadius: "16px" };
  }
}


function calculateAutoNodeSize(title = "", notes = "", showNotes = true, shape = "rounded") {
  const titleText = String(title || "");
  const noteText = showNotes ? String(notes || "") : "";

  const longestLine = Math.max(
    10,
    ...titleText.split("\n").map((line) => line.length),
    ...noteText.split("\n").map((line) => line.length)
  );

  const contentLength = titleText.length + noteText.length;

  let width = Math.min(430, Math.max(240, 190 + longestLine * 4.4));
  let height = showNotes
    ? Math.min(420, Math.max(165, 150 + Math.ceil(contentLength / 42) * 18))
    : 145;

  if (shape === "circle") {
    const size = Math.max(240, Math.min(360, Math.max(width, height)));
    width = size;
    height = size;
  }

  if (shape === "diamond" || shape === "hexagon") {
    width = Math.max(width, 280);
    height = Math.max(height, 210);
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

const defaultNodes = [
  {
    id: "1",
    type: "custom",
    position: { x: 500, y: 60 },
    style: { width: 240, height: 165 },
    data: {
      title: "Main Heading",
      notes: "",
      color: "transparent",
      borderColor: "#d4a017",
      shape: "rounded",
      showNotes: true,
      collapsed: false,
      manualSize: false,
    },
  },
];

const defaultEdges = [];

const IMPORT_COLORS = [
  ["transparent", "#d4a017"],
  ["transparent", "#4285f4"],
  ["transparent", "#34a853"],
  ["transparent", "#9334e6"],
  ["transparent", "#ea4335"],
];

function cleanMarkerText(text = "") {
  return text
    .replace(/^\s*(?:[-•*★]+|\d+(?:\.\d+)*[.)]?|>+)\s*/, "")
    .trim();
}

function parseSmartNotes(input = "") {
  const rawLines = String(input).replace(/\r/g, "").split("\n");
  const entries = [];
  let lastStructural = null;
  let sawBlank = false;

  const countIndent = (line) => {
    const prefix = line.match(/^[\t ]*/)?.[0] || "";
    return prefix.replace(/\t/g, "    ").length;
  };

  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index];
    const trimmed = raw.trim();

    if (!trimmed) {
      sawBlank = true;
      continue;
    }

    const indent = countIndent(raw);
    const bulletMatch = trimmed.match(/^([-•*★])\s*(.+)$/);

    if (bulletMatch) {
      const noteText = bulletMatch[2].trim();
      if (noteText && lastStructural) {
        lastStructural.notes.push(noteText);
      }
      sawBlank = false;
      continue;
    }

    const arrowMatch = trimmed.match(/^((?:>+|→+))\s*(.+)$/);
    const numberMatch = trimmed.match(/^(\d+(?:\.\d+)*)(?:[.)])?\s+(.+)$/);

    let depth = 0;
    let title = trimmed;
    let kind = "plain";

    if (arrowMatch) {
      depth = Math.max(arrowMatch[1].length, Math.floor(indent / 2));
      title = arrowMatch[2].trim();
      kind = "arrow";
    } else if (numberMatch) {
      const numericDepth = numberMatch[1].split(".").length;
      depth = Math.max(1, numericDepth + Math.floor(indent / 2));
      title = numberMatch[2].trim();
      kind = "number";
    } else if (indent > 0) {
      depth = Math.max(1, Math.floor(indent / 2));
      title = cleanMarkerText(trimmed);
      kind = "indent";
    } else if (entries.length === 0) {
      depth = 0;
    } else {
      const existing = entries.find(
        (entry) => entry.title.toLowerCase() === trimmed.toLowerCase()
      );
      if (existing && sawBlank) {
        lastStructural = existing;
        sawBlank = false;
        continue;
      }

      const nextNonEmpty = rawLines
        .slice(index + 1)
        .find((line) => line.trim());
      const nextTrimmed = nextNonEmpty?.trim() || "";
      const nextIsList = /^(?:\d+(?:\.\d+)*[.)]?\s+|[-•*★]\s*)/.test(nextTrimmed);

      depth = sawBlank && nextIsList ? 1 : 1;
    }

    const entry = {
      key: `parsed-${entries.length + 1}`,
      title: title || `Heading ${entries.length + 1}`,
      notes: [],
      requestedDepth: depth,
      kind,
    };

    entries.push(entry);
    lastStructural = entry;
    sawBlank = false;
  }

  if (!entries.length) return null;

  const rootEntry = entries[0];
  rootEntry.requestedDepth = 0;

  const stack = [rootEntry];
  rootEntry.depth = 0;
  rootEntry.parentKey = null;

  for (let i = 1; i < entries.length; i += 1) {
    const entry = entries[i];
    let depth = Math.max(1, entry.requestedDepth || 1);
    depth = Math.min(depth, stack.length);

    while (stack.length > depth) stack.pop();

    const parent = stack[depth - 1] || rootEntry;
    entry.depth = depth;
    entry.parentKey = parent.key;
    stack[depth] = entry;
    stack.length = depth + 1;
  }

  return {
    rootKey: rootEntry.key,
    entries,
  };
}

function parsedTreeToFlow(parsed, { append = false, parentId = "1", shape = "rounded" } = {}) {
  if (!parsed?.entries?.length) return { nodes: [], edges: [] };

  const idMap = {};

  parsed.entries.forEach((entry, index) => {
    idMap[entry.key] = append
      ? `import-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`
      : index === 0
      ? "1"
      : `import-${index + 1}`;
  });

  const createdNodes = parsed.entries.map((entry, index) => {
    const palette = IMPORT_COLORS[Math.min(entry.depth || 0, IMPORT_COLORS.length - 1)];

    return {
      id: idMap[entry.key],
      type: "custom",
      position: { x: 0, y: 0 },
      style: calculateAutoNodeSize(
        entry.title,
        entry.notes.join("\n"),
        entry.notes.length > 0,
        shape
      ),
      data: {
        title: entry.title,
        notes: entry.notes.join("\n"),
        color: "transparent",
        borderColor: palette[1],
        shape,
        showNotes: entry.notes.length > 0,
        collapsed: false,
        manualSize: false,
      },
    };
  });

  const createdEdges = parsed.entries
    .filter((entry) => entry.parentKey)
    .map((entry) => ({
      id: `e-${idMap[entry.parentKey]}-${idMap[entry.key]}`,
      source: idMap[entry.parentKey],
      target: idMap[entry.key],
      type: "smoothstep",
    }));

  if (append) {
    createdEdges.push({
      id: `e-${parentId}-${idMap[parsed.rootKey]}`,
      source: parentId,
      target: idMap[parsed.rootKey],
      type: "smoothstep",
    });
  }

  return { nodes: createdNodes, edges: createdEdges };
}

function CustomNode({ id, data, selected }) {
  const shapeStyle = (() => {
    switch (data.shape) {
      case "square":
        return { borderRadius: "4px" };
      case "extra-rounded":
        return { borderRadius: "30px" };
      case "pill":
        return { borderRadius: "999px" };
      case "oval":
        return { borderRadius: "50%" };
      case "circle":
        return { borderRadius: "50%", width: "240px", minHeight: "240px" };
      case "diamond":
        return {
          borderRadius: "0",
          clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
          padding: "34px",
        };
      case "hexagon":
        return {
          borderRadius: "0",
          clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
          padding: "26px",
        };
      case "parallelogram":
        return {
          borderRadius: "0",
          clipPath: "polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)",
          paddingLeft: "24px",
          paddingRight: "24px",
        };
      default:
        return { borderRadius: "16px" };
    }
  })();

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={180}
        minHeight={110}
        maxWidth={700}
        maxHeight={700}
        keepAspectRatio={data.shape === "circle"}
        onResizeEnd={(_, params) =>
          data.onManualResize(id, params.width, params.height)
        }
      />

      <div
      className={`tree-node shape-${data.shape || "rounded"}`}
      style={{
        background: "transparent",
        borderColor: data.borderColor,
        ...shapeStyle,
      }}
    >
      <Handle type="target" position={Position.Top} />

      <input
        className="node-title nodrag"
        value={data.title}
        onChange={(e) => data.onChangeTitle(id, e.target.value)}
        placeholder="Heading"
      />

      {data.showNotes && (
        <textarea
          className="node-notes nodrag"
          value={data.notes}
          onChange={(e) => data.onChangeNotes(id, e.target.value)}
          placeholder="Write notes..."
        />
      )}

      <div className="node-actions nodrag">
        <button className="add-btn" onClick={() => data.onAddChild(id)}>
          + Child
        </button>

        {data.childCount > 0 && (
          <button
            className="collapse-btn"
            onClick={() => data.onToggleCollapse(id)}
            title={data.collapsed ? "Expand branch" : "Collapse branch"}
          >
            {data.collapsed ? "＋" : "−"}
          </button>
        )}

        <button
          className="notes-toggle-btn"
          onClick={() => data.onToggleNotes(id)}
          title={data.showNotes ? "Hide notes area" : "Show notes area"}
        >
          {data.showNotes ? "📝−" : "📝+"}
        </button>

        <select
          className="shape-select nodrag"
          value={data.shape || "rounded"}
          onChange={(e) => data.onChangeShape(id, e.target.value)}
          title="Choose shape for this row"
          aria-label="Choose shape for this row"
        >
          {BOX_SHAPES.map((shape) => (
            <option key={shape.value} value={shape.value}>
              {shape.label}
            </option>
          ))}
        </select>

        <button
          className="auto-size-btn"
          onClick={() => data.onAutoSize(id)}
          title="Return this box to automatic size"
        >
          Auto
        </button>

        <button
          className="pdf-section-btn"
          onClick={() => data.onTogglePdfSection(id)}
          title={
            data.isPdfSection
              ? "Remove this branch from PDF sections"
              : "Add this whole branch to PDF sections"
          }
        >
          {data.isPdfSection ? "PDF✓" : "PDF+"}
        </button>

        {id !== "1" && (
          <button className="delete-btn" onClick={() => data.onDelete(id)}>
            ✕
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} />
      </div>
    </>
  );
}

function layoutTree(nodes, edges) {
  if (!nodes.length) return nodes;

  const childrenMap = {};

  nodes.forEach((node) => {
    childrenMap[node.id] = [];
  });

  edges.forEach((edge) => {
    if (!childrenMap[edge.source]) {
      childrenMap[edge.source] = [];
    }

    childrenMap[edge.source].push(edge.target);
  });

  let nextLeafX = 0;
  const positions = {};

  function placeNode(id, depth = 0) {
    const children = childrenMap[id] || [];

    if (children.length === 0) {
      positions[id] = {
        x: nextLeafX,
        y: depth * Y_GAP,
      };

      nextLeafX += X_GAP;
      return positions[id].x;
    }

    const childXValues = children.map((childId) =>
      placeNode(childId, depth + 1)
    );

    const firstX = childXValues[0];
    const lastX = childXValues[childXValues.length - 1];

    positions[id] = {
      x: (firstX + lastX) / 2,
      y: depth * Y_GAP,
    };

    return positions[id].x;
  }

  placeNode("1", 0);

  const missingNodes = nodes.filter((node) => !positions[node.id]);

  missingNodes.forEach((node) => {
    positions[node.id] = {
      x: nextLeafX,
      y: 0,
    };

    nextLeafX += X_GAP;
  });

  const allX = Object.values(positions).map((p) => p.x);
  const minX = Math.min(...allX);

  const offset = 120 - minX;

  return nodes.map((node) => ({
    ...node,
    position: {
      x: positions[node.id].x + offset,
      y: positions[node.id].y + 60,
    },
  }));
}

function App() {
  const fileInputRef = useRef(null);
  const [showSmartImport, setShowSmartImport] = useState(false);
  const [smartText, setSmartText] = useState("");
  const [importMode, setImportMode] = useState("replace");
  const [appendParentId, setAppendParentId] = useState("1");
  const [importMessage, setImportMessage] = useState("");

  const [pdfSectionIds, setPdfSectionIds] = useState([]);
  const [includeMasterOverview, setIncludeMasterOverview] = useState(true);

  const [nodes, setNodes, onNodesChange] =
    useNodesState(defaultNodes);

  const [edges, setEdges, onEdgesChange] =
    useEdgesState(defaultEdges);

  const updateNodeData = useCallback(
    (id, changes) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...changes,
                },
              }
            : node
        )
      );
    },
    [setNodes]
  );

  const changeTitle = useCallback(
    (id, title) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== id) return node;

          const data = {
            ...node.data,
            title,
          };

          return {
            ...node,
            data,
            style: data.manualSize
              ? node.style
              : {
                  ...(node.style || {}),
                  ...calculateAutoNodeSize(
                    title,
                    data.notes,
                    data.showNotes,
                    data.shape
                  ),
                },
          };
        })
      );
    },
    [setNodes]
  );

  const changeNotes = useCallback(
    (id, notes) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== id) return node;

          const data = {
            ...node.data,
            notes,
          };

          return {
            ...node,
            data,
            style: data.manualSize
              ? node.style
              : {
                  ...(node.style || {}),
                  ...calculateAutoNodeSize(
                    data.title,
                    notes,
                    data.showNotes,
                    data.shape
                  ),
                },
          };
        })
      );
    },
    [setNodes]
  );

  const manualResize = useCallback(
    (id, width, height) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? {
                ...node,
                style: {
                  ...(node.style || {}),
                  width: Math.round(width),
                  height: Math.round(height),
                },
                data: {
                  ...node.data,
                  manualSize: true,
                },
              }
            : node
        )
      );
    },
    [setNodes]
  );

  const autoSizeNode = useCallback(
    (id) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== id) return node;

          const size = calculateAutoNodeSize(
            node.data.title,
            node.data.notes,
            node.data.showNotes,
            node.data.shape
          );

          return {
            ...node,
            style: {
              ...(node.style || {}),
              ...size,
            },
            data: {
              ...node.data,
              manualSize: false,
            },
          };
        })
      );
    },
    [setNodes]
  );

  const changeShape = useCallback(
    (id, shape) => {
      const parentMap = {};
      edges.forEach((edge) => {
        parentMap[edge.target] = edge.source;
      });

      const getDepth = (nodeId) => {
        let depth = 0;
        let currentId = nodeId;
        const visited = new Set();

        while (parentMap[currentId] && !visited.has(currentId)) {
          visited.add(currentId);
          currentId = parentMap[currentId];
          depth += 1;
        }

        return depth;
      };

      const selectedDepth = getDepth(id);

      setNodes((nds) =>
        nds.map((node) =>
          getDepth(node.id) === selectedDepth
            ? {
                ...node,
                data: {
                  ...node.data,
                  shape,
                },
                style: node.data.manualSize
                  ? node.style
                  : {
                      ...(node.style || {}),
                      ...calculateAutoNodeSize(
                        node.data.title,
                        node.data.notes,
                        node.data.showNotes,
                        shape
                      ),
                    },
              }
            : node
        )
      );
    },
    [edges, setNodes]
  );

  const toggleNotes = useCallback(
    (id) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== id) return node;

          const showNotes = !(node.data.showNotes ?? true);
          const data = {
            ...node.data,
            showNotes,
          };

          return {
            ...node,
            data,
            style: data.manualSize
              ? node.style
              : {
                  ...(node.style || {}),
                  ...calculateAutoNodeSize(
                    data.title,
                    data.notes,
                    showNotes,
                    data.shape
                  ),
                },
          };
        })
      );
    },
    [setNodes]
  );

  const applyGlobalShape = useCallback(
    (shape) => {
      setGlobalShape(shape);
      setNodes((nds) =>
        nds.map((node) => ({
          ...node,
          data: {
            ...node.data,
            shape,
          },
        }))
      );
    },
    [setNodes]
  );


  const togglePdfSection = useCallback((id) => {
    setPdfSectionIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }, []);

  const movePdfSection = useCallback((id, direction) => {
    setPdfSectionIds((current) => {
      const index = current.indexOf(id);
      if (index < 0) return current;

      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const copy = [...current];
      [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
      return copy;
    });
  }, []);

  const removePdfSection = useCallback((id) => {
    setPdfSectionIds((current) =>
      current.filter((item) => item !== id)
    );
  }, []);

  const runAutoLayout = useCallback(() => {
    setNodes((currentNodes) =>
      layoutTree(currentNodes, edges)
    );
  }, [edges, setNodes]);

  const addChild = useCallback(
    (parentId) => {
      const newId = `${Date.now()}-${Math.random()}`;

      const parentNode = nodes.find(
        (node) => node.id === parentId
      );

      if (!parentNode) return;

      const newNode = {
        id: newId,
        type: "custom",
        position: {
          x: parentNode.position.x,
          y: parentNode.position.y + Y_GAP,
        },
        style: calculateAutoNodeSize(
          "New Heading",
          "",
          false,
          "rounded"
        ),
        data: {
          title: "New Heading",
          notes: "",
          color: "transparent",
          borderColor: "#4285f4",
          shape: "rounded",
          showNotes: false,
          collapsed: false,
          manualSize: false,
        },
      };

      const newEdge = {
        id: `e-${parentId}-${newId}`,
        source: parentId,
        target: newId,
        type: "smoothstep",
      };

      const newNodes = nodes.map((node) =>
        node.id === parentId
          ? {
              ...node,
              data: {
                ...node.data,
                collapsed: false,
              },
            }
          : node
      );

      newNodes.push(newNode);

      const newEdges = [...edges, newEdge];

      setNodes(layoutTree(newNodes, newEdges));
      setEdges(newEdges);
    },
    [nodes, edges, setNodes, setEdges]
  );

  const getDescendants = useCallback(
    (startId) => {
      const result = [];

      function walk(id) {
        const childIds = edges
          .filter((edge) => edge.source === id)
          .map((edge) => edge.target);

        childIds.forEach((childId) => {
          result.push(childId);
          walk(childId);
        });
      }

      walk(startId);

      return result;
    },
    [edges]
  );

  const deleteNode = useCallback(
    (id) => {
      const descendants = getDescendants(id);
      const deleteIds = [id, ...descendants];

      const remainingNodes = nodes.filter(
        (node) => !deleteIds.includes(node.id)
      );

      const remainingEdges = edges.filter(
        (edge) =>
          !deleteIds.includes(edge.source) &&
          !deleteIds.includes(edge.target)
      );

      setNodes(
        layoutTree(remainingNodes, remainingEdges)
      );

      setEdges(remainingEdges);
    },
    [
      nodes,
      edges,
      getDescendants,
      setNodes,
      setEdges,
    ]
  );

  const toggleCollapse = useCallback(
    (id) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  collapsed: !node.data.collapsed,
                },
              }
            : node
        )
      );
    },
    [setNodes]
  );

  const childCountMap = useMemo(() => {
    const map = {};

    edges.forEach((edge) => {
      map[edge.source] =
        (map[edge.source] || 0) + 1;
    });

    return map;
  }, [edges]);

  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set();

    function hideChildren(id) {
      const children = edges
        .filter((edge) => edge.source === id)
        .map((edge) => edge.target);

      children.forEach((childId) => {
        hidden.add(childId);
        hideChildren(childId);
      });
    }

    nodes.forEach((node) => {
      if (node.data.collapsed) {
        hideChildren(node.id);
      }
    });

    return hidden;
  }, [nodes, edges]);

  const visibleNodes = useMemo(() => {
    return nodes
      .filter((node) => !hiddenNodeIds.has(node.id))
      .map((node) => ({
        ...node,
        data: {
          ...node.data,
          childCount: childCountMap[node.id] || 0,
          onChangeTitle: changeTitle,
          onChangeNotes: changeNotes,
          onChangeShape: changeShape,
          onToggleNotes: toggleNotes,
          onManualResize: manualResize,
          onAutoSize: autoSizeNode,
          onTogglePdfSection: togglePdfSection,
          isPdfSection: pdfSectionIds.includes(node.id),
          onAddChild: addChild,
          onDelete: deleteNode,
onToggleCollapse: toggleCollapse,
        },
      }));
  }, [
    nodes,
    hiddenNodeIds,
    childCountMap,
    changeTitle,
    changeNotes,
    changeShape,
    toggleNotes,
    manualResize,
    autoSizeNode,
    togglePdfSection,
    pdfSectionIds,
    addChild,
    deleteNode,
toggleCollapse,
  ]);

  const visibleEdges = useMemo(() => {
    return edges.filter(
      (edge) =>
        !hiddenNodeIds.has(edge.source) &&
        !hiddenNodeIds.has(edge.target)
    );
  }, [edges, hiddenNodeIds]);

  const nodeTypes = useMemo(
    () => ({
      custom: CustomNode,
    }),
    []
  );

  const onConnect = useCallback(
    (params) => {
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "smoothstep",
          },
          eds
        )
      );
    },
    [setEdges]
  );

  useEffect(() => {
    const saved =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem(
        "vismay-tree-chart-v1"
      );

    if (!saved) return;

    try {
      const parsed = JSON.parse(saved);

      if (parsed.nodes) {
        const restoredNodes =
          parsed.nodes.map((node) => ({
            ...node,
            data: {
              ...node.data,
              color: "transparent",
              showNotes: node.data.showNotes ?? Boolean(node.data.notes),
              manualSize: node.data.manualSize || false,
              collapsed:
                node.data.collapsed || false,
            },
          }));

        setNodes(restoredNodes);
      }

      if (parsed.edges) {
        setEdges(parsed.edges);
      }
    } catch (error) {
      console.error(
        "Unable to load saved chart",
        error
      );
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    const cleanNodes = nodes.map((node) => ({
      ...node,
      data: {
        title: node.data.title,
        notes: node.data.notes,
        color: "transparent",
        showNotes: node.data.showNotes ?? Boolean(node.data.notes),
        borderColor: node.data.borderColor,
        shape: node.data.shape,
        manualSize: node.data.manualSize || false,
        collapsed:
          node.data.collapsed || false,
      },
    }));

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        nodes: cleanNodes,
        edges,
      })
    );
  }, [nodes, edges]);

  const resetChart = () => {
    const okay = window.confirm(
      "Delete the current tree and start a new chart?"
    );

    if (!okay) return;

    setNodes(defaultNodes);
    setEdges(defaultEdges);
    setPdfSectionIds([]);
    setGlobalShape("rounded");

    localStorage.removeItem(STORAGE_KEY);
  };

  const exportProject = () => {
    const cleanNodes = nodes.map((node) => ({
      ...node,
      data: {
        title: node.data.title,
        notes: node.data.notes,
        color: "transparent",
        showNotes: node.data.showNotes ?? Boolean(node.data.notes),
        borderColor: node.data.borderColor,
        shape: node.data.shape,
        manualSize: node.data.manualSize || false,
        collapsed:
          node.data.collapsed || false,
      },
    }));

    const data = JSON.stringify(
      {
        version: 2,
        nodes: cleanNodes,
        edges,
      },
      null,
      2
    );

    const blob = new Blob([data], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);

    const link =
      document.createElement("a");

    link.href = url;
    link.download =
      "tree-chart-project.json";

    link.click();

    URL.revokeObjectURL(url);
  };

  const importProject = (event) => {
    const file =
      event.target.files?.[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const project =
          JSON.parse(reader.result);

        if (
          !project.nodes ||
          !project.edges
        ) {
          alert(
            "Invalid tree-chart project file."
          );

          return;
        }

        const restoredNodes =
          project.nodes.map((node) => ({
            ...node,
            data: {
              ...node.data,
              color: "transparent",
              showNotes: node.data.showNotes ?? Boolean(node.data.notes),
              manualSize: node.data.manualSize || false,
              collapsed:
                node.data.collapsed || false,
            },
          }));

        setNodes(restoredNodes);
        setEdges(project.edges);
      } catch {
        alert(
          "Unable to read this project file."
        );
      }
    };

    reader.readAsText(file);

    event.target.value = "";
  };

  const exportPNG = async () => {
    try {
      const flow =
        document.querySelector(
          ".react-flow"
        );

      const dataUrl = await toPng(flow, {
        backgroundColor: "#f8fafc",
        pixelRatio: 2,
      });

      const link =
        document.createElement("a");

      link.download =
        "tree-chart.png";

      link.href = dataUrl;

      link.click();
    } catch (error) {
      console.error(error);

      alert("PNG export failed.");
    }
  };

  const getBranchIds = useCallback(
    (rootId) => {
      const result = [rootId];

      const walk = (id) => {
        edges
          .filter((edge) => edge.source === id)
          .forEach((edge) => {
            result.push(edge.target);
            walk(edge.target);
          });
      };

      walk(rootId);
      return result;
    },
    [edges]
  );

  const getAncestorPath = useCallback(
    (nodeId) => {
      const path = [];
      let currentId = nodeId;
      const safety = new Set();

      while (currentId && !safety.has(currentId)) {
        safety.add(currentId);

        const node = nodes.find((item) => item.id === currentId);
        if (!node) break;

        path.unshift({
          id: node.id,
          title: node.data.title || "Untitled",
        });

        const parentEdge = edges.find(
          (edge) => edge.target === currentId
        );

        currentId = parentEdge?.source || null;
      }

      return path;
    },
    [nodes, edges]
  );

  const createBranchImage = async (rootId, overview = false) => {
    const branchIds = overview
      ? nodes.map((node) => node.id)
      : getBranchIds(rootId);

    const branchNodes = nodes.filter((node) =>
      branchIds.includes(node.id)
    );

    const branchEdges = edges.filter(
      (edge) =>
        branchIds.includes(edge.source) &&
        branchIds.includes(edge.target)
    );

    if (!branchNodes.length) {
      throw new Error("Branch has no nodes.");
    }

    const actualRootId = overview
      ? (branchNodes.find((node) => node.id === "1")?.id || branchNodes[0].id)
      : rootId;

    const childrenMap = {};
    branchNodes.forEach((node) => {
      childrenMap[node.id] = [];
    });

    branchEdges.forEach((edge) => {
      if (childrenMap[edge.source]) {
        childrenMap[edge.source].push(edge.target);
      }
    });

    const sizes = {};
    branchNodes.forEach((node) => {
      const auto = calculateAutoNodeSize(
        node.data.title,
        node.data.notes,
        node.data.showNotes,
        node.data.shape
      );

      sizes[node.id] = {
        width: Number(node.style?.width) || auto.width,
        height: Number(node.style?.height) || auto.height,
      };
    });

    const X_GAP_EXPORT = 90;
    const Y_GAP_EXPORT = 105;
    const positions = {};
    let nextLeafX = 0;

    const place = (id, depth = 0) => {
      const children = childrenMap[id] || [];

      if (!children.length) {
        const width = sizes[id]?.width || 240;
        const x = nextLeafX;
        nextLeafX += width + X_GAP_EXPORT;

        positions[id] = {
          x,
          y: depth,
        };

        return x + width / 2;
      }

      const centers = children.map((childId) =>
        place(childId, depth + 1)
      );

      const center =
        (centers[0] + centers[centers.length - 1]) / 2;

      const width = sizes[id]?.width || 240;

      positions[id] = {
        x: center - width / 2,
        y: depth,
      };

      return center;
    };

    place(actualRootId, 0);

    branchNodes
      .filter((node) => !positions[node.id])
      .forEach((node) => {
        const width = sizes[node.id]?.width || 240;
        positions[node.id] = {
          x: nextLeafX,
          y: 0,
        };
        nextLeafX += width + X_GAP_EXPORT;
      });

    const depthHeights = {};
    Object.entries(positions).forEach(([id, pos]) => {
      depthHeights[pos.y] = Math.max(
        depthHeights[pos.y] || 0,
        sizes[id]?.height || 160
      );
    });

    const depthTop = {};
    let runningY = 50;

    Object.keys(depthHeights)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((depth) => {
        depthTop[depth] = runningY;
        runningY += depthHeights[depth] + Y_GAP_EXPORT;
      });

    const minX = Math.min(
      ...Object.entries(positions).map(([id, pos]) => pos.x)
    );

    const xOffset = 50 - minX;

    const drawPositions = {};
    Object.entries(positions).forEach(([id, pos]) => {
      drawPositions[id] = {
        x: pos.x + xOffset,
        y: depthTop[pos.y] || 50,
      };
    });

    const width = Math.max(
      800,
      Math.ceil(
        Math.max(
          ...branchNodes.map((node) =>
            drawPositions[node.id].x + sizes[node.id].width
          )
        ) + 50
      )
    );

    const height = Math.max(
      500,
      Math.ceil(
        Math.max(
          ...branchNodes.map((node) =>
            drawPositions[node.id].y + sizes[node.id].height
          )
        ) + 50
      )
    );

    const SCALE = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * SCALE);
    canvas.height = Math.ceil(height * SCALE);

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Canvas is unavailable.");
    }

    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Connectors first, so boxes remain clean on top.
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    branchEdges.forEach((edge) => {
      const sourcePos = drawPositions[edge.source];
      const targetPos = drawPositions[edge.target];
      const sourceSize = sizes[edge.source];
      const targetSize = sizes[edge.target];

      if (!sourcePos || !targetPos || !sourceSize || !targetSize) {
        return;
      }

      const x1 = sourcePos.x + sourceSize.width / 2;
      const y1 = sourcePos.y + sourceSize.height;
      const x2 = targetPos.x + targetSize.width / 2;
      const y2 = targetPos.y;
      const midY = y1 + (y2 - y1) / 2;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1, midY);
      ctx.lineTo(x2, midY);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });

    const roundedRectPath = (x, y, w, h, radius) => {
      const r = Math.max(
        0,
        Math.min(radius, w / 2, h / 2)
      );

      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(
        x + w,
        y + h,
        x + w - r,
        y + h
      );
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };

    const shapePath = (shape, x, y, w, h) => {
      if (shape === "diamond") {
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w / 2, y + h);
        ctx.lineTo(x, y + h / 2);
        ctx.closePath();
        return;
      }

      if (shape === "hexagon") {
        ctx.beginPath();
        ctx.moveTo(x + w * 0.25, y);
        ctx.lineTo(x + w * 0.75, y);
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w * 0.75, y + h);
        ctx.lineTo(x + w * 0.25, y + h);
        ctx.lineTo(x, y + h / 2);
        ctx.closePath();
        return;
      }

      if (shape === "parallelogram") {
        ctx.beginPath();
        ctx.moveTo(x + w * 0.1, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w * 0.9, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        return;
      }

      if (shape === "circle" || shape === "oval") {
        ctx.beginPath();
        ctx.ellipse(
          x + w / 2,
          y + h / 2,
          w / 2,
          h / 2,
          0,
          0,
          Math.PI * 2
        );
        ctx.closePath();
        return;
      }

      let radius = 16;

      if (shape === "square") radius = 2;
      if (shape === "extra-rounded") radius = 28;
      if (shape === "pill") radius = Math.min(w, h) / 2;

      roundedRectPath(x, y, w, h, radius);
    };

    const wrapText = (value, maxWidth, font) => {
      ctx.font = font;

      const paragraphs = String(value || "").split("\n");
      const lines = [];

      paragraphs.forEach((paragraph, paragraphIndex) => {
        const words = paragraph.split(/\s+/).filter(Boolean);

        if (!words.length) {
          lines.push("");
          return;
        }

        let line = "";

        words.forEach((word) => {
          const candidate = line ? `${line} ${word}` : word;

          if (
            line &&
            ctx.measureText(candidate).width > maxWidth
          ) {
            lines.push(line);
            line = word;
          } else {
            line = candidate;
          }
        });

        if (line) lines.push(line);

        if (
          paragraphIndex < paragraphs.length - 1 &&
          paragraph !== ""
        ) {
          lines.push("");
        }
      });

      return lines;
    };

    branchNodes.forEach((node) => {
      const pos = drawPositions[node.id];
      const size = sizes[node.id];

      if (!pos || !size) return;

      const shape = node.data.shape || "rounded";
      const x = pos.x;
      const y = pos.y;
      const w = size.width;
      const h = size.height;

      shapePath(shape, x, y, w, h);

      ctx.fillStyle = "#ffffff";
      ctx.fill();

      ctx.strokeStyle = node.data.borderColor || "#64748b";
      ctx.lineWidth = 3;
      ctx.stroke();

      let sidePadding = 16;

      if (
        shape === "diamond" ||
        shape === "hexagon" ||
        shape === "parallelogram"
      ) {
        sidePadding = Math.max(28, w * 0.13);
      } else if (shape === "circle" || shape === "oval") {
        sidePadding = Math.max(24, w * 0.12);
      }

      const contentX = x + sidePadding;
      const contentWidth = Math.max(
        80,
        w - sidePadding * 2
      );

      let cursorY = y + 20;

      ctx.fillStyle = "#172033";
      ctx.textBaseline = "top";

      const titleFont =
        '700 18px Arial, Helvetica, sans-serif';
      const titleLines = wrapText(
        node.data.title || "",
        contentWidth,
        titleFont
      );

      ctx.font = titleFont;

      titleLines.forEach((line) => {
        ctx.fillText(line, contentX, cursorY);
        cursorY += 23;
      });

      cursorY += 7;

      ctx.strokeStyle = "rgba(0,0,0,0.16)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(contentX, cursorY);
      ctx.lineTo(contentX + contentWidth, cursorY);
      ctx.stroke();

      cursorY += 10;

      if (node.data.showNotes && node.data.notes) {
        const noteFont =
          '14px Arial, Helvetica, sans-serif';
        const noteLines = wrapText(
          node.data.notes,
          contentWidth,
          noteFont
        );

        ctx.font = noteFont;
        ctx.fillStyle = "#253247";

        const bottomLimit = y + h - 14;

        for (const line of noteLines) {
          if (cursorY + 18 > bottomLimit) {
            break;
          }

          ctx.fillText(line, contentX, cursorY);
          cursorY += 18;
        }
      }
    });

    return {
      dataUrl: canvas.toDataURL("image/png", 1),
      width,
      height,
    };
  };

  const exportPDF = async () => {
    if (!pdfSectionIds.length) {
      alert("Select at least one branch using PDF+.");
      return;
    }

    try {
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
        compress: true,
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const marginX = 16;
      const topMargin = 18;
      const bottomMargin = 16;
      const usableWidth = pageWidth - marginX * 2;

      let pageNumber = 0;

      const addFooter = () => {
        pageNumber += 1;
        pdf.setFontSize(9);
        pdf.setTextColor(95);
        pdf.text(
          `Page ${pageNumber}`,
          pageWidth / 2,
          pageHeight - 7,
          { align: "center" }
        );
      };

      const addNewPage = () => {
        if (pageNumber > 0) {
          pdf.addPage("a4", "portrait");
        }
      };

      const drawArrow = (x, y1, y2) => {
        pdf.setDrawColor(80);
        pdf.setLineWidth(0.5);
        pdf.line(x, y1, x, y2);

        pdf.line(x, y2, x - 1.5, y2 - 2);
        pdf.line(x, y2, x + 1.5, y2 - 2);
      };

      const drawStepBox = (title, notes, y, isRoot = false) => {
        const titleFontSize = isRoot ? 14 : 12;
        const noteFontSize = 9.5;

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(titleFontSize);

        const titleLines = pdf.splitTextToSize(
          title || "Untitled",
          usableWidth - 18
        );

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(noteFontSize);

        const noteLines =
          notes && String(notes).trim()
            ? pdf.splitTextToSize(
                String(notes).trim(),
                usableWidth - 18
              )
            : [];

        const titleHeight = titleLines.length * 5.2;
        const notesHeight = noteLines.length * 4.2;
        const boxHeight = Math.max(
          18,
          8 + titleHeight + (noteLines.length ? 4 + notesHeight : 0)
        );

        const boxX = marginX;
        const boxY = y;
        const boxW = usableWidth;

        pdf.setDrawColor(isRoot ? 40 : 90);
        pdf.setLineWidth(isRoot ? 0.8 : 0.5);
        pdf.roundedRect(
          boxX,
          boxY,
          boxW,
          boxHeight,
          3,
          3,
          "S"
        );

        let textY = boxY + 6;

        pdf.setTextColor(30);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(titleFontSize);

        pdf.text(
          titleLines,
          pageWidth / 2,
          textY,
          { align: "center" }
        );

        textY += titleHeight;

        if (noteLines.length) {
          textY += 2.5;
          pdf.setTextColor(70);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(noteFontSize);

          pdf.text(
            noteLines,
            boxX + 8,
            textY
          );
        }

        return {
          top: boxY,
          bottom: boxY + boxHeight,
          height: boxHeight,
        };
      };

      const getDescendantTree = (rootId) => {
        const childrenByParent = {};

        edges.forEach((edge) => {
          if (!childrenByParent[edge.source]) {
            childrenByParent[edge.source] = [];
          }
          childrenByParent[edge.source].push(edge.target);
        });

        const rows = [];

        const walk = (id, depth = 0) => {
          const node = nodes.find((item) => item.id === id);
          if (!node) return;

          rows.push({
            id,
            depth,
            title: node.data.title || "Untitled",
            notes:
              node.data.showNotes && node.data.notes
                ? node.data.notes
                : "",
          });

          (childrenByParent[id] || []).forEach((childId) =>
            walk(childId, depth + 1)
          );
        };

        walk(rootId, 0);
        return rows;
      };

      for (let sectionIndex = 0; sectionIndex < pdfSectionIds.length; sectionIndex++) {
        const sectionId = pdfSectionIds[sectionIndex];
        const selectedNode = nodes.find((item) => item.id === sectionId);
        if (!selectedNode) continue;

        addNewPage();

        let cursorY = topMargin;

        // Heading
        pdf.setTextColor(25);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(16);
        pdf.text(
          selectedNode.data.title || "Selected Branch",
          pageWidth / 2,
          cursorY,
          { align: "center" }
        );
        cursorY += 9;

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.setTextColor(100);
        pdf.text(
          `Section ${sectionIndex + 1} of ${pdfSectionIds.length}`,
          pageWidth / 2,
          cursorY,
          { align: "center" }
        );
        cursorY += 9;

        // Full ancestry from top/root down to selected node.
        const ancestorPath = getAncestorPath(sectionId);

        for (let i = 0; i < ancestorPath.length; i++) {
          const nodeRef = nodes.find(
            (item) => item.id === ancestorPath[i].id
          );

          const notes =
            nodeRef?.data?.showNotes && nodeRef?.data?.notes
              ? nodeRef.data.notes
              : "";

          // Estimate required box height before drawing.
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(i === 0 ? 14 : 12);
          const tLines = pdf.splitTextToSize(
            ancestorPath[i].title || "Untitled",
            usableWidth - 18
          );

          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(9.5);
          const nLines = notes
            ? pdf.splitTextToSize(notes, usableWidth - 18)
            : [];

          const estimatedHeight = Math.max(
            18,
            8 +
              tLines.length * 5.2 +
              (nLines.length ? 4 + nLines.length * 4.2 : 0)
          );

          if (
            cursorY + estimatedHeight + 14 >
            pageHeight - bottomMargin
          ) {
            addFooter();
            pdf.addPage("a4", "portrait");
            cursorY = topMargin;
          }

          const box = drawStepBox(
            ancestorPath[i].title,
            notes,
            cursorY,
            i === 0
          );

          cursorY = box.bottom + 7;

          if (i < ancestorPath.length - 1) {
            if (cursorY + 8 > pageHeight - bottomMargin) {
              addFooter();
              pdf.addPage("a4", "portrait");
              cursorY = topMargin;
            }

            drawArrow(
              pageWidth / 2,
              box.bottom + 1,
              box.bottom + 6
            );

            cursorY = box.bottom + 9;
          }
        }

        // Descendants after selected branch.
        const descendants = getDescendantTree(sectionId).slice(1);

        if (descendants.length) {
          if (cursorY + 14 > pageHeight - bottomMargin) {
            addFooter();
            pdf.addPage("a4", "portrait");
            cursorY = topMargin;
          }

          cursorY += 2;
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(11);
          pdf.setTextColor(45);
          pdf.text(
            "Sub-branches",
            marginX,
            cursorY
          );
          cursorY += 6;

          descendants.forEach((item) => {
            const indent = Math.min(item.depth, 5) * 8;
            const itemX = marginX + indent;
            const itemWidth = usableWidth - indent;

            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(10.5);

            const childTitleLines = pdf.splitTextToSize(
              item.title,
              itemWidth - 14
            );

            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(9);

            const childNoteLines = item.notes
              ? pdf.splitTextToSize(
                  item.notes,
                  itemWidth - 14
                )
              : [];

            const childHeight = Math.max(
              15,
              6 +
                childTitleLines.length * 4.6 +
                (childNoteLines.length
                  ? 3 + childNoteLines.length * 4
                  : 0)
            );

            if (
              cursorY + childHeight + 9 >
              pageHeight - bottomMargin
            ) {
              addFooter();
              pdf.addPage("a4", "portrait");
              cursorY = topMargin;
            }

            // arrow from level marker
            if (item.depth > 0) {
              pdf.setDrawColor(130);
              pdf.setLineWidth(0.35);
              pdf.line(
                itemX - 4,
                cursorY + 4,
                itemX - 1,
                cursorY + 4
              );
            }

            pdf.setDrawColor(120);
            pdf.setLineWidth(0.4);
            pdf.roundedRect(
              itemX,
              cursorY,
              itemWidth,
              childHeight,
              2.5,
              2.5,
              "S"
            );

            let ty = cursorY + 5;
            pdf.setTextColor(35);
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(10.5);
            pdf.text(
              childTitleLines,
              itemX + 6,
              ty
            );

            ty += childTitleLines.length * 4.6;

            if (childNoteLines.length) {
              ty += 2;
              pdf.setTextColor(80);
              pdf.setFont("helvetica", "normal");
              pdf.setFontSize(9);
              pdf.text(
                childNoteLines,
                itemX + 6,
                ty
              );
            }

            cursorY += childHeight + 6;
          });
        }

        addFooter();
      }

      pdf.save("tree-chart-arrow-flow.pdf");
    } catch (error) {
      console.error(error);
      alert("PDF export failed.");
    }
  };

  const escapeHtml = (text = "") => {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  };

  const parsedSmartTree = useMemo(
    () => parseSmartNotes(smartText),
    [smartText]
  );

  const importSmartTree = () => {
    if (!parsedSmartTree?.entries?.length) {
      setImportMessage("Paste some notes first.");
      return;
    }

    if (importMode === "replace") {
      const created = parsedTreeToFlow(parsedSmartTree, { shape: "rounded" });
      setNodes(layoutTree(created.nodes, created.edges));
      setEdges(created.edges);
      setImportMessage(`Created ${created.nodes.length} chart boxes.`);
    } else {
      const parentExists = nodes.some((node) => node.id === appendParentId);
      const parentId = parentExists ? appendParentId : "1";
      const created = parsedTreeToFlow(parsedSmartTree, {
        append: true,
        parentId,
        shape: "rounded",
      });
      const combinedNodes = [...nodes, ...created.nodes];
      const combinedEdges = [...edges, ...created.edges];
      setNodes(layoutTree(combinedNodes, combinedEdges));
      setEdges(combinedEdges);
      setImportMessage(`Added ${created.nodes.length} chart boxes to the current tree.`);
    }

    setTimeout(() => {
      setShowSmartImport(false);
      setImportMessage("");
    }, 650);
  };

  const exportHTML = () => {
    const arrangedNodes =
      layoutTree(nodes, edges);

    const maxX = Math.max(
      ...arrangedNodes.map(
        (node) => node.position.x
      ),
      800
    );

    const maxY = Math.max(
      ...arrangedNodes.map(
        (node) => node.position.y
      ),
      600
    );

    const width = maxX + 400;
    const height = maxY + 400;

    const nodeById = {};

    arrangedNodes.forEach((node) => {
      nodeById[node.id] = node;
    });

    const lineHtml = edges
      .map((edge) => {
        const source =
          nodeById[edge.source];

        const target =
          nodeById[edge.target];

        if (!source || !target) return "";

        const x1 =
          source.position.x +
          NODE_WIDTH / 2;

        const y1 =
          source.position.y + 170;

        const x2 =
          target.position.x +
          NODE_WIDTH / 2;

        const y2 =
          target.position.y;

        return `
          <line
            x1="${x1}"
            y1="${y1}"
            x2="${x2}"
            y2="${y2}"
            stroke="#64748b"
            stroke-width="3"
          />
        `;
      })
      .join("");

    const nodeHtml = arrangedNodes
      .map((node) => {
        const shape = node.data.shape || "rounded";
        const radius =
          shape === "square" ? "2px" :
          shape === "extra-rounded" ? "28px" :
          shape === "pill" ? "999px" :
          shape === "oval" || shape === "circle" ? "50%" :
          "16px";
        const clipPath =
          shape === "diamond" ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" :
          shape === "hexagon" ? "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)" :
          shape === "parallelogram" ? "polygon(12% 0%, 100% 0%, 88% 100%, 0% 100%)" :
          "none";
        const showNotes = node.data.showNotes ?? Boolean(node.data.notes);

        return `
          <div
            class="node"
            style="
              left:${node.position.x}px;
              top:${node.position.y}px;
              background:transparent;
              border-color:${node.data.borderColor};
              border-radius:${radius};
              clip-path:${clipPath};
            "
          >
            <div class="title">
              ${escapeHtml(node.data.title)}
            </div>

            ${showNotes ? `<div class="notes">
              ${escapeHtml(node.data.notes).replaceAll("\n", "<br>")}
            </div>` : ""}
          </div>
        `;
      })
      .join("");

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Tree Chart Notes</title>

<style>
  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: #f8fafc;
    font-family:
      Arial,
      Helvetica,
      sans-serif;
  }

  header {
    position: sticky;
    top: 0;
    z-index: 50;
    padding: 18px 24px;
    background: white;
    border-bottom: 1px solid #dbe3ec;
  }

  h1 {
    margin: 0;
    font-size: 24px;
    color: #172033;
  }

  .hint {
    margin-top: 5px;
    color: #64748b;
    font-size: 13px;
  }

  .workspace {
    position: relative;
    width: ${width}px;
    height: ${height}px;
    min-width: 100vw;
    min-height: calc(100vh - 80px);
    background-image:
      radial-gradient(
        #cbd5e1 1px,
        transparent 1px
      );
    background-size: 24px 24px;
  }

  svg {
    position: absolute;
    inset: 0;
    width: ${width}px;
    height: ${height}px;
    pointer-events: none;
  }

  .node {
    position: absolute;
    width: ${NODE_WIDTH}px;
    min-height: 170px;
    border: 3px solid;
    padding: 14px;
    box-shadow:
      0 8px 22px
      rgba(15, 23, 42, 0.15);
  }

  .title {
    font-size: 18px;
    font-weight: 800;
    color: #172033;
    border-bottom:
      2px solid
      rgba(0,0,0,.12);
    padding-bottom: 9px;
  }

  .notes {
    margin-top: 11px;
    line-height: 1.5;
    font-size: 14px;
    color: #253247;
    background:
      rgba(255,255,255,.65);
    border-radius: 8px;
    padding: 10px;
    min-height: 75px;
    word-break: break-word;
  }

  @media print {
    header {
      display: none;
    }
  }
</style>
</head>

<body>

<header>
  <h1>Tree Chart Notes</h1>
  <div class="hint">
    Standalone tree chart — this file does not require the website.
  </div>
</header>

<div class="workspace">

  <svg>
    ${lineHtml}
  </svg>

  ${nodeHtml}

</div>

</body>
</html>
    `;

    const blob = new Blob(
      [html],
      {
        type: "text/html",
      }
    );

    const url =
      URL.createObjectURL(blob);

    const link =
      document.createElement("a");

    link.href = url;

    link.download =
      "tree-chart.html";

    link.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Tree Chart Notes</h1>

          <p>
            Create, connect and preserve
            your notes visually.
          </p>
        </div>

        <div className="toolbar">
          <button
            onClick={() => addChild("1")}
          >
            + Main Branch
          </button>

          <button
            className="smart-import-button"
            onClick={() => {
              setImportMessage("");
              setShowSmartImport(true);
            }}
          >
            ✨ Smart Notes → Tree
          </button>

          <button onClick={runAutoLayout}>
            Auto Layout
          </button>

          <button onClick={exportHTML}>
            HTML
          </button>

          <button onClick={exportPNG}>
            PNG
          </button>

          <button onClick={exportPDF}>
            Create PDF
          </button>

          <button onClick={exportProject}>
            Save Project
          </button>

          <button
            onClick={() =>
              fileInputRef.current?.click()
            }
          >
            Open Project
          </button>

          <button
            className="reset-button"
            onClick={resetChart}
          >
            New Chart
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={importProject}
            hidden
          />
        </div>
      </header>

      <div className="save-status">
        ✓ Changes are saved
        automatically on this device
      </div>

      {showSmartImport && (
        <div className="smart-import-backdrop" role="presentation">
          <section
            className="smart-import-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="smart-import-title"
          >
            <div className="smart-import-header">
              <div>
                <h2 id="smart-import-title">Smart Notes → Tree</h2>
                <p>
                  Paste a ChatGPT tree or your own notes. Numbered lines create child boxes;
                  bullets and stars become notes inside the latest box.
                </p>
              </div>
              <button
                className="close-import-button"
                onClick={() => setShowSmartImport(false)}
                aria-label="Close smart import"
              >
                ✕
              </button>
            </div>

            <div className="smart-import-grid">
              <div className="smart-input-column">
                <label htmlFor="smart-notes-input">Paste notes / ChatGPT tree</label>
                <textarea
                  id="smart-notes-input"
                  value={smartText}
                  onChange={(event) => {
                    setSmartText(event.target.value);
                    setImportMessage("");
                  }}
                  placeholder={`Economic Growth\n1. GDP\n   * Production increases\n   * Income increases\n2. Inflation\n   * Prices increase\n3. Interest Rates\n   * RBI may raise rates`}
                />

                <div className="format-help symbol-guide">
                  <strong>How the website reads symbols</strong>
                  <div><code>Normal text</code> → Main heading / section box</div>
                  <div><code>1. 2. 3.</code> or <code>1) 2)</code> → Child boxes</div>
                  <div><code>1.1 / 1.2 / 2.1</code> → Deeper child boxes</div>
                  <div><code>&gt; / &gt;&gt; / →</code> → Explicit tree depth</div>
                  <div><code>Spaces / Tab</code> → Deeper level by indentation</div>
                  <div><code>- • * ★</code> → Notes inside the latest box</div>
                  <div><code>Blank line</code> → Separates sections</div>
                </div>

                <fieldset className="import-mode">
                  <legend>Where should it go?</legend>
                  <label>
                    <input
                      type="radio"
                      name="import-mode"
                      value="replace"
                      checked={importMode === "replace"}
                      onChange={() => setImportMode("replace")}
                    />
                    Create new tree (replace current chart)
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="import-mode"
                      value="append"
                      checked={importMode === "append"}
                      onChange={() => setImportMode("append")}
                    />
                    Append to current tree
                  </label>
                </fieldset>

                {importMode === "append" && (
                  <label className="append-parent-label">
                    Attach imported root under
                    <select
                      value={appendParentId}
                      onChange={(event) => setAppendParentId(event.target.value)}
                    >
                      {nodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.data.title || "Untitled node"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="smart-preview-column">
                <div className="preview-title-row">
                  <h3>Preview</h3>
                  <span>
                    {parsedSmartTree?.entries?.length || 0} boxes
                  </span>
                </div>

                <div className="tree-preview">
                  {!parsedSmartTree?.entries?.length ? (
                    <div className="preview-empty">
                      Paste notes on the left to preview the hierarchy.
                    </div>
                  ) : (
                    parsedSmartTree.entries.map((entry) => (
                      <div
                        className="preview-entry"
                        key={entry.key}
                        style={{ paddingLeft: `${Math.min(entry.depth || 0, 6) * 20}px` }}
                      >
                        <div className="preview-heading">
                          <span className="preview-branch">↳</span>
                          {entry.title}
                        </div>
                        {entry.notes.length > 0 && (
                          <div className="preview-notes">
                            {entry.notes.join(" · ")}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="smart-import-footer">
              <span className="import-message" aria-live="polite">
                {importMessage}
              </span>
              <div>
                <button
                  className="secondary-import-button"
                  onClick={() => setShowSmartImport(false)}
                >
                  Cancel
                </button>
                <button
                  className="create-tree-button"
                  onClick={importSmartTree}
                  disabled={!parsedSmartTree?.entries?.length}
                >
                  {importMode === "append" ? "Append Tree" : "Create Tree"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      <section
        className="pdf-sections-panel"
        style={{
          margin: "8px 14px 10px",
          padding: "10px 12px",
          border: "1px solid rgba(15,23,42,.14)",
          borderRadius: "10px",
          background: "rgba(255,255,255,.92)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <strong>PDF Sections</strong>

          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
            }}
          >
            <input
              type="checkbox"
              checked={includeMasterOverview}
              onChange={(event) =>
                setIncludeMasterOverview(event.target.checked)
              }
            />
            Include Master Overview as Page 1
          </label>

          <span
            style={{
              fontSize: "12px",
              color: "#64748b",
            }}
          >
            Click PDF+ on any box to add its entire branch.
          </span>
        </div>

        {pdfSectionIds.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "7px",
              marginTop: "9px",
            }}
          >
            {pdfSectionIds.map((id, index) => {
              const sectionNode = nodes.find(
                (node) => node.id === id
              );

              return (
                <div
                  key={id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "5px 7px",
                    border: "1px solid #d7dee8",
                    borderRadius: "8px",
                    background: "#ffffff",
                    fontSize: "12px",
                  }}
                >
                  <strong>{index + 1}.</strong>
                  <span
                    style={{
                      display: "inline-flex",
                      flexDirection: "column",
                      gap: "2px",
                    }}
                  >
                    <strong>
                      {sectionNode?.data?.title || "Untitled"}
                    </strong>

                    <small
                      style={{
                        color: "#64748b",
                        fontWeight: 500,
                        maxWidth: "320px",
                        whiteSpace: "normal",
                      }}
                    >
                      {getAncestorPath(id)
                        .slice(0, -1)
                        .map((item) => item.title)
                        .join(" > ") || "Root branch"}
                    </small>
                  </span>

                  <button
                    type="button"
                    onClick={() => movePdfSection(id, -1)}
                    disabled={index === 0}
                    title="Move earlier"
                  >
                    ↑
                  </button>

                  <button
                    type="button"
                    onClick={() => movePdfSection(id, 1)}
                    disabled={index === pdfSectionIds.length - 1}
                    title="Move later"
                  >
                    ↓
                  </button>

                  <button
                    type="button"
                    onClick={() => removePdfSection(id)}
                    title="Remove from PDF"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <main className="flow-wrapper">
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.1}
          maxZoom={2}
          defaultEdgeOptions={{
            type: "smoothstep",
          }}
        >
          <Background
            gap={24}
            size={1}
          />

          <Controls />

          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={3}
          />
        </ReactFlow>
      </main>
    </div>
  );
}

export default App;