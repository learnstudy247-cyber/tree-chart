import { useCallback, useEffect, useMemo, useRef } from "react";
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

const defaultNodes = [
  {
    id: "1",
    type: "custom",
    position: { x: 500, y: 60 },
    data: {
      title: "Main Heading",
      notes: "Write your notes here...",
      color: "#fff7cc",
      borderColor: "#d4a017",
      shape: "rounded",
      collapsed: false,
    },
  },
];

const defaultEdges = [];

function CustomNode({ id, data }) {
  const shapeStyle =
    data.shape === "square"
      ? { borderRadius: "4px" }
      : data.shape === "pill"
      ? { borderRadius: "40px" }
      : { borderRadius: "16px" };

  return (
    <div
      className="tree-node"
      style={{
        background: data.color,
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

      <textarea
        className="node-notes nodrag"
        value={data.notes}
        onChange={(e) => data.onChangeNotes(id, e.target.value)}
        placeholder="Write notes..."
      />

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

        <button className="style-btn" onClick={() => data.onStyle(id)}>
          🎨
        </button>

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
          notes: "Write your notes here...",
          color: "#e8f4ff",
          borderColor: "#4285f4",
          shape: "rounded",
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

  const styleNode = useCallback(
    (id) => {
      const colors = [
        ["#fff7cc", "#d4a017"],
        ["#e8f4ff", "#4285f4"],
        ["#e8f8ee", "#34a853"],
        ["#fdecec", "#ea4335"],
        ["#f3e8ff", "#9334e6"],
        ["#ffffff", "#444444"],
      ];

      const shapes = [
        "rounded",
        "square",
        "pill",
      ];

      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== id) return node;

          let colorIndex = colors.findIndex(
            ([background]) =>
              background === node.data.color
          );

          if (colorIndex === -1) colorIndex = 0;

          const nextColor =
            colors[(colorIndex + 1) % colors.length];

          let shapeIndex = shapes.indexOf(
            node.data.shape
          );

          if (shapeIndex === -1) shapeIndex = 0;

          const nextShape =
            shapes[(shapeIndex + 1) % shapes.length];

          return {
            ...node,
            data: {
              ...node.data,
              color: nextColor[0],
              borderColor: nextColor[1],
              shape: nextShape,
            },
          };
        })
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
          onAddChild: addChild,
          onDelete: deleteNode,
          onStyle: styleNode,
          onToggleCollapse: toggleCollapse,
        },
      }));
  }, [
    nodes,
    hiddenNodeIds,
    childCountMap,
    changeTitle,
    changeNotes,
    addChild,
    deleteNode,
    styleNode,
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
        color: node.data.color,
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

    localStorage.removeItem(STORAGE_KEY);
  };

  const exportProject = () => {
    const cleanNodes = nodes.map((node) => ({
      ...node,
      data: {
        title: node.data.title,
        notes: node.data.notes,
        color: node.data.color,
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
        const radius =
          node.data.shape === "square"
            ? "4px"
            : node.data.shape === "pill"
            ? "40px"
            : "16px";

        return `
          <div
            class="node"
            style="
              left:${node.position.x}px;
              top:${node.position.y}px;
              background:${node.data.color};
              border-color:${node.data.borderColor};
              border-radius:${radius};
            "
          >
            <div class="title">
              ${escapeHtml(node.data.title)}
            </div>

            <div class="notes">
              ${escapeHtml(node.data.notes)
                .replaceAll(
                  "\n",
                  "<br>"
                )}
            </div>
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