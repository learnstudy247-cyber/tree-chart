import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
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

const defaultNodes = [
  {
    id: "1",
    type: "custom",
    position: { x: 500, y: 60 },
    data: {
      title: "Main Heading",
      notes: "",
      color: "transparent",
      borderColor: "#d4a017",
      shape: "rounded",
      showNotes: true,
      collapsed: false,
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
      data: {
        title: entry.title,
        notes: entry.notes.join("\n"),
        color: "transparent",
        borderColor: palette[1],
        shape,
        showNotes: entry.notes.length > 0,
        collapsed: false,
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

function CustomNode({ id, data }) {
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

        {id !== "1" && (
          <button className="delete-btn" onClick={() => data.onDelete(id)}>
            ✕
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} />
    </div>
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
      updateNodeData(id, { title });
    },
    [updateNodeData]
  );

  const changeNotes = useCallback(
    (id, notes) => {
      updateNodeData(id, { notes });
    },
    [updateNodeData]
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
        nds.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  showNotes: !(node.data.showNotes ?? true),
                },
              }
            : node
        )
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
        data: {
          title: "New Heading",
          notes: "",
          color: "transparent",
          borderColor: "#4285f4",
          shape: "rounded",
          showNotes: false,
          collapsed: false,
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

  const exportPDF = async () => {
    try {
      const flow =
        document.querySelector(
          ".react-flow"
        );

      const dataUrl = await toPng(flow, {
        backgroundColor: "#ffffff",
        pixelRatio: 2,
      });

      const image = new Image();

      image.src = dataUrl;

      image.onload = () => {
        const pdf = new jsPDF({
          orientation:
            image.width > image.height
              ? "landscape"
              : "portrait",
          unit: "px",
          format: [
            image.width,
            image.height,
          ],
        });

        pdf.addImage(
          dataUrl,
          "PNG",
          0,
          0,
          image.width,
          image.height
        );

        pdf.save("tree-chart.pdf");
      };
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
            PDF
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