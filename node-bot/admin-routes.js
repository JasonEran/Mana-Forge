const path = require("path");

function registerAdminRoutes(app, deps) {
  const {
    appendBackgroundAudit,
    appendVectorRebuildAudit,
    asyncLoadBackgroundMemory,
    backgroundAuditPath,
    baseDir,
    buildIndexFromAuditFile,
    env,
    fs,
    getBackgroundReviewer,
    persistAuditIndex,
    persistBackgroundMeta,
    state,
    vectorRebuildAuditPath,
  } = deps;

    // Admin endpoints for file write approvals
    const PENDING_DIR = path.join(baseDir, "data", "pending_writes");
    const ADMIN_SECRET =
      (deps.env && deps.env.MANA_ADMIN_SECRET) ||
      env.MANA_ADMIN_SECRET ||
      "";

    function checkAdminAuth(req, res) {
      if (!ADMIN_SECRET) return true; // no secret configured -> allow (local dev)
      const header = req.get("authorization") || req.get("Authorization") || "";
      if (!header || !header.startsWith("Bearer ")) {
        res.status(401).json({ ok: false, error: "unauthorized" });
        return false;
      }
      const token = header.slice(7).trim();
      if (token !== ADMIN_SECRET) {
        res.status(401).json({ ok: false, error: "unauthorized" });
        return false;
      }
      return true;
    }

    app.route("/admin/pending-writes").get(async (req, res) => {
      if (!checkAdminAuth(req, res)) return;
      try {
        await fs.promises.mkdir(PENDING_DIR, { recursive: true });
        const files = await fs.promises.readdir(PENDING_DIR);
        const pending = [];
        for (const f of files) {
          if (
            f.endsWith(".json") &&
            !f.endsWith(".approved.json") &&
            !f.endsWith(".rejected.json")
          ) {
            const id = f.replace(/\.json$/i, "");
            const base = path.join(PENDING_DIR, id);
            const pendingPath = `${base}.json`;
            let payload = null;
            try {
              payload = JSON.parse(
                await fs.promises.readFile(pendingPath, "utf8"),
              );
            } catch (e) {
              payload = null;
            }
            const approved = fs.existsSync(`${base}.approved.json`);
            const rejected = fs.existsSync(`${base}.rejected.json`);
            pending.push({ id, payload, approved, rejected });
          }
        }
        return res.json({ ok: true, pending });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    });

    app.route("/admin/pending-writes/:id/approve").post(async (req, res) => {
      if (!checkAdminAuth(req, res)) return;
      try {
        const id = req.params.id;
        const base = path.join(PENDING_DIR, id);
        const approvedPath = `${base}.approved.json`;
        const data = {
          approver: req.body?.approver || "local-user",
          at: new Date().toISOString(),
          note: req.body?.note || null,
        };
        await fs.promises.writeFile(
          approvedPath,
          JSON.stringify(data, null, 2),
          "utf8",
        );
        // Optionally archive immediately
        try {
          const archiveDir = path.join(PENDING_DIR, "archive");
          await fs.promises.mkdir(archiveDir, { recursive: true });
          const pendingPath = `${base}.json`;
          let pendingPayload = null;
          try {
            pendingPayload = JSON.parse(
              await fs.promises.readFile(pendingPath, "utf8"),
            );
          } catch (e) {
            pendingPayload = null;
          }
          const outPath = path.join(archiveDir, `${id}.approved.json`);
          const archiveObj = {
            id,
            status: "approved",
            pending: pendingPayload,
            action: data,
            archivedAt: new Date().toISOString(),
          };
          await fs.promises.writeFile(
            outPath,
            JSON.stringify(archiveObj, null, 2),
            "utf8",
          );
          // remove originals
          try {
            if (fs.existsSync(pendingPath))
              await fs.promises.unlink(pendingPath);
          } catch (e) {}
          try {
            if (fs.existsSync(approvedPath))
              await fs.promises.unlink(approvedPath);
          } catch (e) {}
        } catch (e) {
          // ignore archive errors
        }

        return res.json({ ok: true, id });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    });

    app.route("/admin/pending-writes/:id/reject").post(async (req, res) => {
      if (!checkAdminAuth(req, res)) return;
      try {
        const id = req.params.id;
        const base = path.join(PENDING_DIR, id);
        const rejectedPath = `${base}.rejected.json`;
        const data = {
          approver: req.body?.approver || "local-user",
          at: new Date().toISOString(),
          reason: req.body?.reason || null,
        };
        await fs.promises.writeFile(
          rejectedPath,
          JSON.stringify(data, null, 2),
          "utf8",
        );
        // Optionally archive immediately
        try {
          const archiveDir = path.join(PENDING_DIR, "archive");
          await fs.promises.mkdir(archiveDir, { recursive: true });
          const pendingPath = `${base}.json`;
          let pendingPayload = null;
          try {
            pendingPayload = JSON.parse(
              await fs.promises.readFile(pendingPath, "utf8"),
            );
          } catch (e) {
            pendingPayload = null;
          }
          const outPath = path.join(archiveDir, `${id}.rejected.json`);
          const archiveObj = {
            id,
            status: "rejected",
            pending: pendingPayload,
            action: data,
            archivedAt: new Date().toISOString(),
          };
          await fs.promises.writeFile(
            outPath,
            JSON.stringify(archiveObj, null, 2),
            "utf8",
          );
          // remove originals
          try {
            if (fs.existsSync(pendingPath))
              await fs.promises.unlink(pendingPath);
          } catch (e) {}
          try {
            if (fs.existsSync(rejectedPath))
              await fs.promises.unlink(rejectedPath);
          } catch (e) {}
        } catch (e) {
          // ignore archive errors
        }

        return res.json({ ok: true, id });
      } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    });

    // Admin token-cache endpoints
    app.route("/admin/token-cache").get(async (req, res) => {
      if (!checkAdminAuth(req, res)) return;
      try {
        const cachePath = path.join(
          baseDir,
          "data",
          "token_count_cache.json",
        );
        if (!fs.existsSync(cachePath))
          return res.json({ ok: true, keys: [], count: 0 });
        const txt = await fs.promises.readFile(cachePath, "utf8");
        const obj = JSON.parse(txt || "{}");
        const keys = Object.keys(obj);
        return res.json({ ok: true, keys, count: keys.length });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
      }
    });

    app.route("/admin/token-cache/evict").post(async (req, res) => {
      if (!checkAdminAuth(req, res)) return;
      try {
        const p = typeof req.body?.path === "string" ? req.body.path : null;
        if (!p)
          return res.status(400).json({ ok: false, error: "path required" });
        const cachePath = path.join(
          baseDir,
          "data",
          "token_count_cache.json",
        );
        let cache = {};
        try {
          if (fs.existsSync(cachePath))
            cache = JSON.parse(
              (await fs.promises.readFile(cachePath, "utf8")) || "{}",
            );
        } catch (e) {
          cache = {};
        }
        const key = path.resolve(p);
        if (cache[key]) delete cache[key];
        await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
        await fs.promises.writeFile(
          cachePath,
          JSON.stringify(cache, null, 2),
          "utf8",
        );
        return res.json({ ok: true, evicted: key });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
      }
    });

    // proxy metrics from Python token HTTP server if available
    app.route("/admin/token-cache-metrics").get(async (req, res) => {
      if (!checkAdminAuth(req, res)) return;
      try {
        const pyPort = Number(env.PY_TOKEN_SERVER_PORT || 9000);
        const pySecret = env.PY_TOKEN_SERVER_SECRET || null;
        const url = `http://127.0.0.1:${pyPort}/metrics`;
        const headers = {};
        if (pySecret) headers["Authorization"] = `Bearer ${pySecret}`;
        const fetch = require("node-fetch");
        const resp = await fetch(url, { headers, method: "GET" });
        const body = await resp.text();
        try {
          const parsed = JSON.parse(body);
          return res.json({ ok: true, metrics: parsed.metrics || parsed });
        } catch (e) {
          return res
            .status(502)
            .json({ ok: false, error: "invalid_metrics_response" });
        }
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
      }
    });

    // Admin endpoints: background memory preview & apply (preview returns a dry-run of reviewer)
    app.route("/admin/background-memory/preview").get(async (req, res) => {
      if (!checkAdminAuth(req, res)) return;
      try {
        if (typeof getBackgroundReviewer() !== "function") {
          return res
            .status(500)
            .json({ ok: false, error: "reviewer_unavailable" });
        }
        const preview = await getBackgroundReviewer()(false);
        return res.json({ ok: true, preview });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
      }
    });

    app.route("/admin/background-memory/apply").post(async (req, res) => {
      if (!checkAdminAuth(req, res)) return;
      try {
        // If body contains explicit changes, apply them; otherwise run reviewer and apply its result
        const body = req.body || {};
        if (
          body &&
          (Array.isArray(body.remove_indices) ||
            body.compacted ||
            Array.isArray(body.important_facts))
        ) {
          // manual apply
          const payloadRemove = Array.isArray(body.remove_indices)
            ? body.remove_indices
            : [];
          const payloadImportant = Array.isArray(body.important_facts)
            ? body.important_facts
            : [];
          const payloadCompacted =
            typeof body.compacted === "string"
              ? String(body.compacted).trim()
              : null;

          const resLoad = await asyncLoadBackgroundMemory();
          const processedFiles =
            resLoad && resLoad.processedFiles ? resLoad.processedFiles : [];
          const applied = { removed: [], important: [], compacted: null };

          // apply removals
          for (const idx of payloadRemove) {
            if (!Number.isInteger(idx)) continue;
            const i = Number(idx) - 1;
            const pf = processedFiles[i];
            if (
              pf &&
              pf.file &&
              state.backgroundMemoryMeta.files &&
              state.backgroundMemoryMeta.files[pf.file]
            ) {
              state.backgroundMemoryMeta.files[pf.file].pruned = true;
              state.backgroundMemoryMeta.files[pf.file].summary = "";
              applied.removed.push(pf.file);
            }
          }

          // important facts
          if (payloadImportant && payloadImportant.length) {
            state.backgroundMemoryMeta.important_facts = payloadImportant.slice(
              0,
              200,
            );
            applied.important = state.backgroundMemoryMeta.important_facts;
          }

          // compacted
          if (payloadCompacted) {
            const maxChars = Number(
              env.MANA_BACKGROUND_MEMORY_MAX_CHARS || 2000,
            );
            let compactText = payloadCompacted.replace(/\s+/g, " ").trim();
            if (compactText.length > maxChars)
              compactText = compactText.slice(0, maxChars).trim() + "...";
            state.backgroundMemoryBlock = `[BACKGROUND MEMORY]\n${compactText}\n[END BACKGROUND MEMORY]`;
            applied.compacted = compactText;
          }

          try {
            await persistBackgroundMeta();
          } catch (e) {
            // ignore
          }

          // Audit entry
          try {
            const header = req.get("authorization") || "";
            const approver =
              (body && body.approver) || (header ? "admin" : "local-user");
            const audit = {
              at: new Date().toISOString(),
              approver,
              action: "manual_apply",
              removed: applied.removed || [],
              important_facts: applied.important || [],
              compacted: (applied.compacted || "").slice(0, 2000),
            };
            await appendBackgroundAudit(audit);
          } catch (e) {
            console.warn(
              "Failed to write background audit (manual):",
              e && e.message ? e.message : e,
            );
          }

          return res.json({ ok: true, applied });
        }

        // otherwise run the reviewer and apply its recommendations
        if (typeof getBackgroundReviewer() !== "function") {
          return res
            .status(500)
            .json({ ok: false, error: "reviewer_unavailable" });
        }
        const result = await getBackgroundReviewer()(true);

        // Audit reviewer application
        try {
          const header = req.get("authorization") || "";
          const approver = header ? "admin" : "system";
          const audit = {
            at: new Date().toISOString(),
            approver,
            action: "reviewer_apply",
            result: result && result.parsed ? result.parsed : null,
            processedFilesCount:
              result && result.processedFiles
                ? result.processedFiles.length
                : 0,
          };
          await appendBackgroundAudit(audit);
        } catch (e) {
          console.warn(
            "Failed to write background audit (reviewer):",
            e && e.message ? e.message : e,
          );
        }

        return res.json({ ok: true, result });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
      }
    });

  // Admin endpoint: read audit entries (supports pagination, free-text search, and structured filters)
  app.route("/admin/background-memory/audit").get(async (req, res) => {
    if (!checkAdminAuth(req, res)) return;
    try {
      const offset = Math.max(0, Number(req.query.offset || 0));
      const limit = Math.max(1, Math.min(1000, Number(req.query.limit || 50)));
      const q =
        typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";

      // structured filters
      const approverFilter =
        typeof req.query.approver === "string"
          ? req.query.approver.trim().toLowerCase()
          : null;
      const actionFilter =
        typeof req.query.action === "string"
          ? req.query.action.trim().toLowerCase()
          : null;
      const fromTs = req.query.from ? Date.parse(String(req.query.from)) : null;
      const toTs = req.query.to ? Date.parse(String(req.query.to)) : null;

      if (!fs.existsSync(backgroundAuditPath))
        return res.json({ ok: true, total: 0, entries: [] });

      const txt = await fs.promises.readFile(backgroundAuditPath, "utf8");
      const lines = (txt || "").trim().split(/\r?\n/).filter(Boolean);
      const parsed = lines.map((l) => {
        try {
          return JSON.parse(l);
        } catch (e) {
          return { raw: l };
        }
      });
      parsed.reverse(); // newest first

      const filtered = parsed.filter((e) => {
        try {
          if (approverFilter) {
            const a = (e.approver || "").toString().toLowerCase();
            if (!a.includes(approverFilter)) return false;
          }
          if (actionFilter) {
            const a = (e.action || "").toString().toLowerCase();
            if (!a.includes(actionFilter)) return false;
          }
          if (fromTs || toTs) {
            const at = e.at ? Date.parse(String(e.at)) : NaN;
            if (fromTs && (!at || at < fromTs)) return false;
            if (toTs && (!at || at > toTs)) return false;
          }
          if (q) {
            if (!JSON.stringify(e).toLowerCase().includes(q)) return false;
          }
          return true;
        } catch (ex) {
          return false;
        }
      });

      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit);

      // determine index freshness
      let indexUpToDate = false;
      try {
        const st = await fs.promises
          .stat(backgroundAuditPath)
          .catch(() => ({ size: 0 }));
        const currentSize = st.size || 0;
        indexUpToDate =
          state.backgroundAuditIndex &&
          Number(state.backgroundAuditIndex.lastSize || 0) === Number(currentSize);
      } catch (e) {
        indexUpToDate = false;
      }

      return res.json({
        ok: true,
        total,
        offset,
        limit,
        entries: page,
        indexUpToDate,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Admin endpoint: rebuild audit index on-demand (synchronous)
  app.route("/admin/background-memory/audit/rebuild").post(async (req, res) => {
    if (!checkAdminAuth(req, res)) return;
    try {
      if (state.backgroundAuditRebuildLock) {
        return res
          .status(409)
          .json({ ok: false, error: "rebuild_in_progress" });
      }
      state.backgroundAuditRebuildLock = true;
      try {
        const result = await buildIndexFromAuditFile();
        state.backgroundAuditLastRebuild = new Date().toISOString();
        return res.json({
          ok: true,
          entries:
            result && result.entries
              ? result.entries.length
              : (state.backgroundAuditIndex.entries || []).length,
          lastSize:
            (result && result.lastSize) || state.backgroundAuditIndex.lastSize || 0,
        });
      } finally {
        state.backgroundAuditRebuildLock = false;
      }
    } catch (e) {
      state.backgroundAuditRebuildLock = false;
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Admin endpoint: rebuild audit index with streaming progress (NDJSON)
  app.route("/admin/background-memory/audit/rebuild/stream").get(async (req, res) => {
    if (!checkAdminAuth(req, res)) return;
    try {
      if (state.backgroundAuditRebuildLock) {
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.write(JSON.stringify({ error: "rebuild_in_progress" }) + "\n");
        return res.end();
      }
      state.backgroundAuditRebuildLock = true;
      state.backgroundAuditLastRebuild = new Date().toISOString();

      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // if no file, emit done
      if (!fs.existsSync(backgroundAuditPath)) {
        const doneObj = { done: true, entries: 0, lastSize: 0 };
        res.write(JSON.stringify(doneObj) + "\n");
        state.backgroundAuditRebuildLock = false;
        return res.end();
      }

      const st = await fs.promises
        .stat(backgroundAuditPath)
        .catch(() => ({ size: 0 }));
      const totalBytes = st.size || 0;

      const stream = fs.createReadStream(backgroundAuditPath, {
        encoding: "utf8",
      });
      const readline = require("readline");
      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity,
      });

      let offset = 0;
      let count = 0;
      const entries = [];
      const reportEvery = Number(env.AUDIT_INDEX_REPORT_EVERY || 200);

      let aborted = false;
      req.on("close", () => {
        aborted = true;
        try {
          rl.close();
        } catch (e) {}
        try {
          stream.destroy();
        } catch (e) {}
      });

      for await (const line of rl) {
        if (aborted) break;
        const len = Buffer.byteLength(line + "\n", "utf8");
        let meta = { raw: line };
        try {
          meta = JSON.parse(line);
        } catch (e) {}
        entries.push({
          at: meta.at || null,
          approver: meta.approver || null,
          action: meta.action || null,
          offset,
          length: len,
        });
        offset += len;
        count += 1;
        if (count % reportEvery === 0) {
          const progress = {
            processedLines: count,
            bytesProcessed: offset,
            totalBytes,
            percent: totalBytes
              ? Math.round((offset / totalBytes) * 100)
              : null,
          };
          res.write(JSON.stringify({ progress }) + "\n");
          // flush
        }
      }

      // finalize index
      state.backgroundAuditIndex = { entries, lastSize: offset };
      await persistAuditIndex();

      const doneObj = { done: true, entries: entries.length, lastSize: offset };
      res.write(
        JSON.stringify({
          progress: {
            processedLines: count,
            bytesProcessed: offset,
            totalBytes,
            percent: totalBytes
              ? Math.round((offset / totalBytes) * 100)
              : null,
          },
        }) + "\n",
      );
      res.write(JSON.stringify(doneObj) + "\n");
      state.backgroundAuditRebuildLock = false;
      return res.end();
    } catch (e) {
      state.backgroundAuditRebuildLock = false;
      try {
        res.write(JSON.stringify({ error: String(e) }) + "\n");
      } catch (er) {}
      try {
        res.end();
      } catch (er) {}
    }
  });

  // CSV export endpoint (supports same filters)
  app.route("/admin/background-memory/audit.csv").get(async (req, res) => {
    if (!checkAdminAuth(req, res)) return;
    try {
      const offset = Math.max(0, Number(req.query.offset || 0));
      const limit = Math.max(
        1,
        Math.min(10000, Number(req.query.limit || 1000)),
      );
      const q =
        typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
      const approverFilter =
        typeof req.query.approver === "string"
          ? req.query.approver.trim().toLowerCase()
          : null;
      const actionFilter =
        typeof req.query.action === "string"
          ? req.query.action.trim().toLowerCase()
          : null;
      const fromTs = req.query.from ? Date.parse(String(req.query.from)) : null;
      const toTs = req.query.to ? Date.parse(String(req.query.to)) : null;

      if (!fs.existsSync(backgroundAuditPath))
        return res.status(200).send("");

      const txt = await fs.promises.readFile(backgroundAuditPath, "utf8");
      const lines = (txt || "").trim().split(/\r?\n/).filter(Boolean);
      const parsed = lines
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch (e) {
            return { raw: l };
          }
        })
        .reverse();

      const filtered = parsed.filter((e) => {
        try {
          if (approverFilter) {
            const a = (e.approver || "").toString().toLowerCase();
            if (!a.includes(approverFilter)) return false;
          }
          if (actionFilter) {
            const a = (e.action || "").toString().toLowerCase();
            if (!a.includes(actionFilter)) return false;
          }
          if (fromTs || toTs) {
            const at = e.at ? Date.parse(String(e.at)) : NaN;
            if (fromTs && (!at || at < fromTs)) return false;
            if (toTs && (!at || at > toTs)) return false;
          }
          if (q) {
            if (!JSON.stringify(e).toLowerCase().includes(q)) return false;
          }
          return true;
        } catch (ex) {
          return false;
        }
      });

      const page = filtered.slice(offset, offset + limit);

      // Build CSV
      const hdr = [
        "at",
        "approver",
        "action",
        "removed_count",
        "important_facts",
        "compacted",
        "raw",
      ];
      function esc(v) {
        if (v === null || v === undefined) return "";
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return '"' + s.replace(/"/g, '""') + '"';
      }

      const rows = [hdr.join(",")];
      for (const e of page) {
        const removedCount = Array.isArray(e.removed)
          ? e.removed.length
          : e.result && e.result.removeIndices
            ? e.result.removeIndices.length
            : 0;
        const important = Array.isArray(e.important_facts)
          ? e.important_facts.join("; ")
          : Array.isArray(e.importantFacts)
            ? e.importantFacts.join("; ")
            : "";
        const compacted = (
          e.compacted ||
          (e.result && e.result.compacted) ||
          ""
        )
          .toString()
          .slice(0, 2000);
        const raw = JSON.stringify(e);
        const row = [
          e.at || "",
          e.approver || "",
          e.action || "",
          String(removedCount),
          important,
          compacted,
          raw,
        ]
          .map(esc)
          .join(",");
        rows.push(row);
      }

      const csv = rows.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="background_audit.csv"`,
      );
      return res.send(csv);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Admin endpoint: send a tray notification (protected)
  // Admin endpoints for retriever index: rebuild and search
  app.route("/admin/retriever/rebuild").post(async (req, res) => {
    // inline admin auth (avoid relying on outer-scope helper to ensure this handler works in all contexts)
    const ADMIN_SECRET_ENV = env.MANA_ADMIN_SECRET || "";
    if (ADMIN_SECRET_ENV) {
      const header = req.get("authorization") || req.get("Authorization") || "";
      if (!header || !header.startsWith("Bearer "))
        return res.status(401).json({ ok: false, error: "unauthorized" });
      const token = header.slice(7).trim();
      if (token !== ADMIN_SECRET_ENV)
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    try {
      const retrieverIndex = require("./tools/retriever-index");
      const roots =
        Array.isArray(req.body?.roots) && req.body.roots.length
          ? req.body.roots
          : [env.RETRIEVER_INDEX_ROOT || path.resolve(baseDir, "..")];
      const exts =
        Array.isArray(req.body?.exts) && req.body.exts.length
          ? req.body.exts
          : undefined;
      const maxFiles = req.body?.maxFiles || undefined;
      const result = await retrieverIndex.buildIndex({ roots, exts, maxFiles });
      return res.json({
        ok: true,
        builtAt: result.builtAt,
        count: Array.isArray(result.entries) ? result.entries.length : 0,
      });
    } catch (e) {
      console.warn(
        "/admin/retriever/rebuild failed:",
        e && e.message ? e.message : e,
      );
      return res
        .status(500)
        .json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  app.route("/admin/retriever/search").get(async (req, res) => {
    const ADMIN_SECRET_ENV = env.MANA_ADMIN_SECRET || "";
    if (ADMIN_SECRET_ENV) {
      const header = req.get("authorization") || req.get("Authorization") || "";
      if (!header || !header.startsWith("Bearer "))
        return res.status(401).json({ ok: false, error: "unauthorized" });
      const token = header.slice(7).trim();
      if (token !== ADMIN_SECRET_ENV)
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const k = Math.max(1, Math.min(50, Number(req.query.k || 5)));
      if (!q)
        return res.status(400).json({ ok: false, error: "q is required" });
      const retrieverIndex = require("./tools/retriever-index");
      // Prefer vector-store search when available (faster for large corpora)
      try {
        const vsModule = require("./tools/vector-store");
        const createStore =
          vsModule && vsModule.createStore ? vsModule.createStore : null;
        if (createStore) {
          const store = createStore({
            dir:
              env.VECTOR_STORE_DIR ||
              path.join(baseDir, "..", "tools", "vector_store"),
          });
          await store.init();
          await store.load();
          const cnt = (await store.count().catch(() => 0)) || 0;
          if (cnt > 0) {
            // try to compute embedding for query
            let qembed = null;
            try {
              if (typeof retrieverIndex.computeEmbedding === "function") {
                qembed = await retrieverIndex.computeEmbedding(q);
              }
            } catch (e) {
              qembed = null;
            }
            if (qembed) {
              try {
                const hits = await store.search(qembed, k);
                const out = [];
                for (const h of hits) {
                  const p = h.path || h.id;
                  let snippet = "";
                  try {
                    snippet = String(
                      await fs.promises.readFile(p, "utf8"),
                    ).slice(0, 800);
                  } catch (e) {
                    snippet = "";
                  }
                  out.push({ id: h.id, path: p, score: h.score, snippet });
                }
                return res.json({ ok: true, results: out, vectorStore: true });
              } catch (e) {
                // continue to fallback
              }
            }
          }
        }
      } catch (e) {
        // ignore vector store errors and fall back to retriever-index
      }

      const results = await retrieverIndex.search(q, k);
      return res.json({ ok: true, results });
    } catch (e) {
      console.warn(
        "/admin/retriever/search failed:",
        e && e.message ? e.message : e,
      );
      return res
        .status(500)
        .json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  // Incremental scan endpoint: performs an incremental update of the retriever index
  app.route("/admin/retriever/scan-incremental").post(async (req, res) => {
    const ADMIN_SECRET_ENV = env.MANA_ADMIN_SECRET || "";
    if (ADMIN_SECRET_ENV) {
      const header = req.get("authorization") || req.get("Authorization") || "";
      if (!header || !header.startsWith("Bearer "))
        return res.status(401).json({ ok: false, error: "unauthorized" });
      const token = header.slice(7).trim();
      if (token !== ADMIN_SECRET_ENV)
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    try {
      const retrieverIndex = require("./tools/retriever-index");
      const roots =
        Array.isArray(req.body?.roots) && req.body.roots.length
          ? req.body.roots
          : [env.RETRIEVER_INDEX_ROOT || path.resolve(baseDir, "..")];
      const exts =
        Array.isArray(req.body?.exts) && req.body.exts.length
          ? req.body.exts
          : undefined;
      const maxFiles = req.body?.maxFiles || undefined;
      const result = await retrieverIndex.incrementalScan({
        roots,
        exts,
        maxFiles,
      });
      return res.json({ ok: true, result });
    } catch (e) {
      console.warn(
        "/admin/retriever/scan-incremental failed:",
        e && e.message ? e.message : e,
      );
      return res
        .status(500)
        .json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  // Retriever status endpoint
  app.route("/admin/retriever/status").get(async (req, res) => {
    const ADMIN_SECRET_ENV = env.MANA_ADMIN_SECRET || "";
    if (ADMIN_SECRET_ENV) {
      const header = req.get("authorization") || req.get("Authorization") || "";
      if (!header || !header.startsWith("Bearer "))
        return res.status(401).json({ ok: false, error: "unauthorized" });
      const token = header.slice(7).trim();
      if (token !== ADMIN_SECRET_ENV)
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    try {
      const retrieverIndex = require("./tools/retriever-index");
      const idx = retrieverIndex.loadIndexSync();
      return res.json({
        ok: true,
        meta: idx.meta || {},
        builtAt: idx.builtAt || null,
        count: Array.isArray(idx.entries) ? idx.entries.length : 0,
      });
    } catch (e) {
      console.warn(
        "/admin/retriever/status failed:",
        e && e.message ? e.message : e,
      );
      return res
        .status(500)
        .json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  // Embedding worker endpoints
  app.route("/admin/retriever/embeddings/rebuild").post(async (req, res) => {
    const ADMIN_SECRET_ENV = env.MANA_ADMIN_SECRET || "";
    if (ADMIN_SECRET_ENV) {
      const header = req.get("authorization") || req.get("Authorization") || "";
      if (!header || !header.startsWith("Bearer "))
        return res.status(401).json({ ok: false, error: "unauthorized" });
      const token = header.slice(7).trim();
      if (token !== ADMIN_SECRET_ENV)
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    try {
      const embWorker = require("./tools/embedding-worker");
      const result = await embWorker.enqueueAll({});
      return res.json({ ok: true, queued: result.queued, total: result.total });
    } catch (e) {
      console.warn(
        "/admin/retriever/embeddings/rebuild failed:",
        e && e.message ? e.message : e,
      );
      return res
        .status(500)
        .json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  app.route("/admin/retriever/embeddings/status").get(async (req, res) => {
    const ADMIN_SECRET_ENV = env.MANA_ADMIN_SECRET || "";
    if (ADMIN_SECRET_ENV) {
      const header = req.get("authorization") || req.get("Authorization") || "";
      if (!header || !header.startsWith("Bearer "))
        return res.status(401).json({ ok: false, error: "unauthorized" });
      const token = header.slice(7).trim();
      if (token !== ADMIN_SECRET_ENV)
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    try {
      const embWorker = require("./tools/embedding-worker");
      const st = embWorker.status();
      return res.json({ ok: true, status: st });
    } catch (e) {
      console.warn(
        "/admin/retriever/embeddings/status failed:",
        e && e.message ? e.message : e,
      );
      return res
        .status(500)
        .json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  // Admin endpoints: vector store rebuild & status
  app.route("/admin/retriever/vector/rebuild").post(async (req, res) => {
    const ADMIN_SECRET_ENV = env.MANA_ADMIN_SECRET || "";
    if (ADMIN_SECRET_ENV) {
      const header = req.get("authorization") || req.get("Authorization") || "";
      if (!header || !header.startsWith("Bearer "))
        return res.status(401).json({ ok: false, error: "unauthorized" });
      const token = header.slice(7).trim();
      if (token !== ADMIN_SECRET_ENV)
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    try {
      const retrieverIndex = require("./tools/retriever-index");
      const dir = req.body?.dir || env.VECTOR_STORE_DIR;
      // record audit start
      try {
        const header =
          req.get("authorization") || req.get("Authorization") || "";
        const approver =
          header && header.startsWith("Bearer ") ? "admin" : "system";
        await appendVectorRebuildAudit({
          at: new Date().toISOString(),
          approver,
          action: "vector_rebuild",
          status: "started",
          dir: dir || null,
        });
      } catch (e) {}

      const result = await retrieverIndex.buildVectorStore({ dir });

      // record audit done
      try {
        const header =
          req.get("authorization") || req.get("Authorization") || "";
        const approver =
          header && header.startsWith("Bearer ") ? "admin" : "system";
        await appendVectorRebuildAudit({
          at: new Date().toISOString(),
          approver,
          action: "vector_rebuild",
          status: result && result.ok ? "done" : "failed",
          dir: dir || null,
          added:
            result && typeof result.added !== "undefined" ? result.added : null,
          count:
            result && typeof result.count !== "undefined" ? result.count : null,
        });
      } catch (e) {}

      return res.json(Object.assign({ ok: true }, result || {}));
    } catch (e) {
      console.warn(
        "/admin/retriever/vector/rebuild failed:",
        e && e.message ? e.message : e,
      );
      return res
        .status(500)
        .json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  app.route("/admin/retriever/vector/status").get(async (req, res) => {
    const ADMIN_SECRET_ENV = env.MANA_ADMIN_SECRET || "";
    if (ADMIN_SECRET_ENV) {
      const header = req.get("authorization") || req.get("Authorization") || "";
      if (!header || !header.startsWith("Bearer "))
        return res.status(401).json({ ok: false, error: "unauthorized" });
      const token = header.slice(7).trim();
      if (token !== ADMIN_SECRET_ENV)
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    try {
      const vsModule = require("./tools/vector-store");
      const createStore =
        vsModule && vsModule.createStore ? vsModule.createStore : null;
      if (!createStore)
        return res.json({ ok: true, available: false, count: 0 });
      const store = createStore({
        dir:
          env.VECTOR_STORE_DIR ||
          path.join(baseDir, "..", "tools", "vector_store"),
      });
      await store.init();
      await store.load();
      const cnt = (await store.count().catch(() => 0)) || 0;
      return res.json({ ok: true, available: true, count: cnt });
    } catch (e) {
      console.warn(
        "/admin/retriever/vector/status failed:",
        e && e.message ? e.message : e,
      );
      return res
        .status(500)
        .json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  // Vector rebuild audit endpoints
  app.route("/admin/retriever/vector/rebuild/audit").get(async (req, res) => {
    const ADMIN_SECRET_ENV = env.MANA_ADMIN_SECRET || "";
    if (ADMIN_SECRET_ENV) {
      const header = req.get("authorization") || req.get("Authorization") || "";
      if (!header || !header.startsWith("Bearer "))
        return res.status(401).json({ ok: false, error: "unauthorized" });
      const token = header.slice(7).trim();
      if (token !== ADMIN_SECRET_ENV)
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    try {
      if (!fs.existsSync(vectorRebuildAuditPath))
        return res.json({ ok: true, total: 0, entries: [] });
      const txt = await fs.promises.readFile(vectorRebuildAuditPath, "utf8");
      const lines = (txt || "").split(/\r?\n/).filter(Boolean);
      let parsed = lines.map((l) => {
        try {
          return JSON.parse(l);
        } catch (e) {
          return { raw: l };
        }
      });
      parsed.reverse(); // newest first

      const offset = Math.max(0, Number(req.query.offset || 0));
      const limit = Math.max(1, Math.min(1000, Number(req.query.limit || 50)));
      const q =
        typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
      const fromTs = req.query.from ? Date.parse(String(req.query.from)) : null;
      const toTs = req.query.to ? Date.parse(String(req.query.to)) : null;

      const filtered = parsed.filter((e) => {
        try {
          if (fromTs || toTs) {
            const at = e.at ? Date.parse(String(e.at)) : NaN;
            if (fromTs && (!at || at < fromTs)) return false;
            if (toTs && (!at || at > toTs)) return false;
          }
          if (q) {
            if (!JSON.stringify(e).toLowerCase().includes(q)) return false;
          }
          return true;
        } catch (ex) {
          return false;
        }
      });

      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit);
      return res.json({ ok: true, total, offset, limit, entries: page });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  app.route("/admin/retriever/vector/rebuild/audit.csv").get(async (req, res) => {
    const ADMIN_SECRET_ENV = env.MANA_ADMIN_SECRET || "";
    if (ADMIN_SECRET_ENV) {
      const header = req.get("authorization") || req.get("Authorization") || "";
      if (!header || !header.startsWith("Bearer "))
        return res.status(401).json({ ok: false, error: "unauthorized" });
      const token = header.slice(7).trim();
      if (token !== ADMIN_SECRET_ENV)
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    try {
      if (!fs.existsSync(vectorRebuildAuditPath))
        return res.status(200).send("");
      const txt = await fs.promises.readFile(vectorRebuildAuditPath, "utf8");
      const lines = (txt || "").split(/\r?\n/).filter(Boolean);
      const parsed = lines
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch (e) {
            return { raw: l };
          }
        })
        .reverse();

      const hdr = [
        "at",
        "approver",
        "action",
        "status",
        "dir",
        "added",
        "count",
        "durationMs",
        "error",
        "raw",
      ];
      function esc(v) {
        if (v === null || v === undefined) return "";
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return '"' + s.replace(/"/g, '""') + '"';
      }
      const rows = [hdr.join(",")];
      for (const e of parsed) {
        const row = [
          esc(e.at || ""),
          esc(e.approver || ""),
          esc(e.action || ""),
          esc(e.status || ""),
          esc(e.dir || ""),
          esc(e.added || ""),
          esc(e.count || ""),
          esc(e.durationMs || ""),
          esc(e.error || ""),
          esc(e.raw || ""),
        ].join(",");
        rows.push(row);
      }
      const csv = rows.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="vector_rebuild_audit.csv"`,
      );
      return res.send(csv);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Streamed vector rebuild with NDJSON progress (admin-protected)
  app.route("/admin/retriever/vector/rebuild/stream").get(async (req, res) => {
    const ADMIN_SECRET_ENV = env.MANA_ADMIN_SECRET || "";
    if (ADMIN_SECRET_ENV) {
      const header = req.get("authorization") || req.get("Authorization") || "";
      if (!header || !header.startsWith("Bearer "))
        return res.status(401).json({ ok: false, error: "unauthorized" });
      const token = header.slice(7).trim();
      if (token !== ADMIN_SECRET_ENV)
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    if (state.vectorStoreRebuildLock) {
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.write(JSON.stringify({ error: "rebuild_in_progress" }) + "\n");
      return res.end();
    }

    state.vectorStoreRebuildLock = true;
    const startMs = Date.now();
    // audit: started
    try {
      const header = req.get("authorization") || req.get("Authorization") || "";
      const approver =
        header && header.startsWith("Bearer ") ? "admin" : "system";
      await appendVectorRebuildAudit({
        at: new Date().toISOString(),
        approver,
        action: "vector_rebuild",
        status: "started",
        dir:
          env.VECTOR_STORE_DIR ||
          path.join(baseDir, "..", "tools", "vector_store"),
      });
    } catch (e) {}

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      const retrieverIndex = require("./tools/retriever-index");
      const vsModule = require("./tools/vector-store");
      const createStore =
        vsModule && vsModule.createStore ? vsModule.createStore : null;
      if (!createStore) {
        res.write(JSON.stringify({ error: "no_vector_store_adapter" }) + "\n");
        state.vectorStoreRebuildLock = false;
        return res.end();
      }

      const storeDir =
        env.VECTOR_STORE_DIR ||
        path.join(baseDir, "..", "tools", "vector_store");
      const store = createStore({ dir: storeDir });
      await store.init();
      await store.load();

      const idx = retrieverIndex.loadIndexSync();
      const entries = Array.isArray(idx.entries) ? idx.entries : [];
      const total = entries.length;
      let processed = 0;
      let added = 0;
      const reportEvery = Number(
        env.VECTOR_REBUILD_REPORT_EVERY || 100,
      );

      // stream initial status
      res.write(JSON.stringify({ progress: { total } }) + "\n");

      for (const e of entries) {
        if (!e || !Array.isArray(e.embedding) || !e.embedding.length) {
          processed += 1;
          if (processed % reportEvery === 0) {
            res.write(
              JSON.stringify({ progress: { processed, added } }) + "\n",
            );
          }
          continue;
        }
        try {
          await store.add(e.id, e.embedding, { path: e.path });
          added += 1;
        } catch (err) {
          // ignore individual add failures but report
          res.write(JSON.stringify({ warn: String(err) }) + "\n");
        }
        processed += 1;
        if (processed % reportEvery === 0) {
          res.write(JSON.stringify({ progress: { processed, added } }) + "\n");
        }
      }

      // attempt to build index and save
      try {
        if (typeof store.buildIndex === "function") await store.buildIndex();
      } catch (e) {
        res.write(
          JSON.stringify({
            warn: "build_index_failed",
            error: (e && e.message) || String(e),
          }) + "\n",
        );
      }
      try {
        if (typeof store.save === "function") await store.save();
      } catch (e) {
        res.write(
          JSON.stringify({
            warn: "save_failed",
            error: (e && e.message) || String(e),
          }) + "\n",
        );
      }

      const cnt = (await store.count().catch(() => 0)) || 0;
      const metaFile = path.join(storeDir, "vector_store_meta.json");
      try {
        await fs.promises.mkdir(storeDir, { recursive: true });
      } catch (e) {}
      try {
        const metaObj = {
          lastBuilt: new Date().toISOString(),
          added,
          count: cnt,
        };
        await fs.promises.writeFile(
          metaFile,
          JSON.stringify(metaObj, null, 2),
          "utf8",
        );
        res.write(
          JSON.stringify({
            done: true,
            entries: cnt,
            added,
            lastBuilt: metaObj.lastBuilt,
          }) + "\n",
        );
      } catch (e) {
        res.write(
          JSON.stringify({
            done: true,
            entries: cnt,
            added,
            error: (e && e.message) || String(e),
          }) + "\n",
        );
      }

      // final flush
      const duration = Date.now() - startMs;
      res.write(
        JSON.stringify({
          summary: { durationMs: duration, added, count: cnt },
        }) + "\n",
      );

      // audit: done
      try {
        const header =
          req.get("authorization") || req.get("Authorization") || "";
        const approver =
          header && header.startsWith("Bearer ") ? "admin" : "system";
        await appendVectorRebuildAudit({
          at: new Date().toISOString(),
          approver,
          action: "vector_rebuild",
          status: "done",
          dir: storeDir,
          added,
          count: cnt,
          durationMs: duration,
        });
      } catch (e) {}

      return res.end();
    } catch (e) {
      try {
        res.write(
          JSON.stringify({ error: (e && e.message) || String(e) }) + "\n",
        );
      } catch (er) {}
      try {
        res.end();
      } catch (er) {}

      // audit: failed
      try {
        const header =
          req.get("authorization") || req.get("Authorization") || "";
        const approver =
          header && header.startsWith("Bearer ") ? "admin" : "system";
        await appendVectorRebuildAudit({
          at: new Date().toISOString(),
          approver,
          action: "vector_rebuild",
          status: "failed",
          dir: env.VECTOR_STORE_DIR || storeDir,
          error: (e && e.message) || String(e),
        });
      } catch (er) {}
    } finally {
      state.vectorStoreRebuildLock = false;
    }
  });

  app.route("/admin/notify/tray").post(async (req, res) => {
    const ADMIN_SECRET_ENV = env.MANA_ADMIN_SECRET || "";
    if (ADMIN_SECRET_ENV) {
      const header = req.get("authorization") || req.get("Authorization") || "";
      if (!header || !header.startsWith("Bearer "))
        return res.status(401).json({ ok: false, error: "unauthorized" });
      const token = header.slice(7).trim();
      if (token !== ADMIN_SECRET_ENV)
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    try {
      const body = req.body || {};
      const title =
        typeof body.title === "string" ? body.title : "Mana Notification";
      const text = typeof body.text === "string" ? body.text : "";
      const type = typeof body.type === "string" ? body.type : "info";
      const data = body.data || null;

      try {
        const bt = app && app.locals && app.locals.broadcastTrayNotification;
        if (typeof bt === "function") {
          bt({ type, title, text, data, at: new Date().toISOString() });
          return res.json({ ok: true });
        } else {
          return res
            .status(500)
            .json({ ok: false, error: "tray_server_unavailable" });
        }
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
      }
    } catch (e) {
      return res.status(400).json({ ok: false, error: String(e) });
    }
  });
}

module.exports = { registerAdminRoutes };
