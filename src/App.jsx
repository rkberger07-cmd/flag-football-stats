import React, { useEffect, useMemo, useState } from "react";

// 5v5 Flag Football Stat Tracker (MVP)
// - Single-file React app
// - Works offline with localStorage
// - Track roster, games, and tap-to-log stat events
// - Auto-computes player totals (offense + defense)
//
// How to use:
// 1) Create players (Roster)
// 2) Create a game (Games)
// 3) Open a game and tap quick actions to log plays
// 4) See live box score + export JSON

type Id = string;

type Player = {
  id: Id;
  name: string;
  jersey?: string;
  position?: string;
};

type RuleSet = "NEXT_LEVEL" | "NFL_FLAG" | "FARM_LEAGUE";

type Game = {
  id: Id;
  opponent: string;
  dateISO: string; // YYYY-MM-DD
  ruleSet: RuleSet;
  notes?: string;
  events: StatEvent[];
};

const RULESET_LABEL: Record<RuleSet, string> = {
  NEXT_LEVEL: "Next Level",
  NFL_FLAG: "NFL FLAG",
  FARM_LEAGUE: "Farm League",
};

const RULESET_CONFIG: Record<RuleSet, { allowPatReturn: boolean; patReturnPoints: number }> = {
  NEXT_LEVEL: { allowPatReturn: false, patReturnPoints: 0 },
  NFL_FLAG: { allowPatReturn: false, patReturnPoints: 0 },
  FARM_LEAGUE: { allowPatReturn: true, patReturnPoints: 2 },
};

const RULESET_HELP: Record<RuleSet, { pat1: string; pat2: string; notes: string[] }> = {
  NEXT_LEVEL: {
    pat1: "1 point (from 5 yards)",
    pat2: "2 points (from 12 yards)",
    notes: [
      "No points for PAT returns (per your Next Level rules).",
      "PAT tries are conversions (1 or 2) — don’t log a TD (6) during the try.",
    ],
  },
  NFL_FLAG: {
    pat1: "1 point (from 5 yards, pass-only)",
    pat2: "2 points (from 10 yards)",
    notes: ["PAT tries are conversions (1 or 2) — don’t log a TD (6) during the try."],
  },
  FARM_LEAGUE: {
    pat1: "1 point (from 5 yards, no-run zone)",
    pat2: "2 points (from 12 yards)",
    notes: [
      "Defense CAN return a PAT for 2 points (per your Farm League rules).",
      "TDs on normal offense are 6; PAT tries are conversions (1 or 2).",
    ],
  },
};



type EventType =
  | "PASS_ATT"
  | "PASS_COMP"
  | "PASS_TD"
  | "INT_THROWN"
  | "RUSH_ATT"
  | "RUSH_TD"
  | "REC"
  | "REC_TD"
  | "DEF_INT"
  | "SACK"
  | "FLAG_PULL"
  | "DEF_TD"
  | "XP_1"
  | "XP_2"
  | "PAT_RET_2";

// For most events, playerId is the primary credited player.
// For passing plays, you can add receiverId to credit the catch/rec TD.
// For DEF_TD, use playerId as the scorer.

type StatEvent = {
  id: Id;
  ts: number;
  type: EventType;
  playerId: Id;
  receiverId?: Id; // for PASS_COMP / PASS_TD
  yards?: number; // optional
  note?: string;
};

type PlayerStats = {
  // Passing
  passAtt: number;
  passComp: number;
  passTD: number;
  intThrown: number;

  // Rushing
  rushAtt: number;
  rushTD: number;

  // Receiving
  rec: number;
  recTD: number;

  // Defense
  defInt: number;
  sacks: number;
  flagPulls: number;
  defTD: number;

  // Scoring
  xp1: number;
  xp2: number;
  patRet2: number; // defensive return on PAT (Farm League)
  points: number;
};


const emptyStats = (): PlayerStats => ({
  passAtt: 0,
  passComp: 0,
  passTD: 0,
  intThrown: 0,
  rushAtt: 0,
  rushTD: 0,
  rec: 0,
  recTD: 0,
  defInt: 0,
  sacks: 0,
  flagPulls: 0,
  defTD: 0,
  xp1: 0,
  xp2: 0,
  patRet2: 0,
  points: 0,
});

function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

const STORAGE_KEY = "flag_5v5_stat_tracker_v1";

type Store = {
  players: Player[];
  games: Game[];
  ui: { selectedGameId?: Id };
};

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { players: [], games: [], ui: {} };
    const parsed = JSON.parse(raw) as Store;
    // basic shape guards
    return {
      players: Array.isArray(parsed.players) ? parsed.players : [],
      games: Array.isArray(parsed.games)
      ? parsed.games.map((g: any) => ({
          ...g,
          ruleSet: (g?.ruleSet as RuleSet) || "NFL_FLAG",
          events: Array.isArray(g?.events) ? g.events : [],
        }))
      : [],
      ui: parsed.ui ?? {},
    };
  } catch {
    return { players: [], games: [], ui: {} };
  }
}

function saveStore(store: Store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function computeStats(players: Player[], events: StatEvent[]) {
  const byId: Record<string, PlayerStats> = {};
  for (const p of players) byId[p.id] = emptyStats();

  const ensure = (pid: Id) => {
    if (!byId[pid]) byId[pid] = emptyStats();
    return byId[pid];
  };

  for (const e of events) {
    const s = ensure(e.playerId);

    switch (e.type) {
      case "PASS_ATT":
        s.passAtt += 1;
        break;
      case "PASS_COMP":
        s.passAtt += 1;
        s.passComp += 1;
        if (e.receiverId) {
          const r = ensure(e.receiverId);
          r.rec += 1;
        }
        break;
      case "PASS_TD":
        // Credit a completed pass TD to passer AND receiver
        s.passAtt += 1;
        s.passComp += 1;
        s.passTD += 1;
        s.points += 6;
        if (e.receiverId) {
          const r = ensure(e.receiverId);
          r.rec += 1;
          r.recTD += 1;
          r.points += 6;
        }
        break;
      case "INT_THROWN":
        s.passAtt += 1;
        s.intThrown += 1;
        break;
      case "RUSH_ATT":
        s.rushAtt += 1;
        break;
      case "RUSH_TD":
        s.rushAtt += 1;
        s.rushTD += 1;
        s.points += 6;
        break;
      case "REC":
        s.rec += 1;
        break;
      case "REC_TD":
        s.rec += 1;
        s.recTD += 1;
        s.points += 6;
        break;
      case "DEF_INT":
        s.defInt += 1;
        break;
      case "SACK":
        s.sacks += 1;
        break;
      case "FLAG_PULL":
        s.flagPulls += 1;
        break;
      case "DEF_TD":
        s.defTD += 1;
        s.points += 6;
        break;
      case "XP_1":
        s.xp1 += 1;
        s.points += 1;
        break;
      case "XP_2":
        s.xp2 += 1;
        s.points += 2;
        break;
      case "PAT_RET_2":
        // Defensive return on PAT (Farm League): 2 points
        s.patRet2 += 1;
        s.points += 2;
        break;
      default:
        break;
    }
  }

  return byId;
}

function fmtDate(iso: string) {
  // Expect YYYY-MM-DD
  return iso;
}

function cls(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ");
}

const SectionTitle: React.FC<{ children: React.ReactNode }>=({children})=> (
  <div className="text-lg font-semibold tracking-tight">{children}</div>
);

const Card: React.FC<{ children: React.ReactNode; className?: string }>=({children, className})=> (
  <div className={cls("rounded-2xl shadow-sm border border-neutral-200 bg-white", className)}>{children}</div>
);

const CardBody: React.FC<{ children: React.ReactNode; className?: string }>=({children, className})=> (
  <div className={cls("p-4", className)}>{children}</div>
);

const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }>=({variant="primary", className, ...props})=> (
  <button
    {...props}
    className={cls(
      "rounded-xl px-3 py-2 text-sm font-medium transition active:scale-[0.99] disabled:opacity-50",
      variant === "primary" && "bg-neutral-900 text-white hover:bg-neutral-800",
      variant === "ghost" && "bg-transparent border border-neutral-200 hover:bg-neutral-50",
      variant === "danger" && "bg-red-600 text-white hover:bg-red-500",
      className
    )}
  />
);

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    className={cls(
      "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none",
      "focus:ring-2 focus:ring-neutral-200"
    )}
  />
);

const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => (
  <select
    {...props}
    className={cls(
      "w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none",
      "focus:ring-2 focus:ring-neutral-200"
    )}
  />
);

export default function App() {
  const [store, setStore] = useState<Store>(() => loadStore());

  useEffect(() => {
    saveStore(store);
  }, [store]);

  const playersById = useMemo(() => {
    const m: Record<string, Player> = {};
    for (const p of store.players) m[p.id] = p;
    return m;
  }, [store.players]);

  const selectedGame = useMemo(
    () => store.games.find((g) => g.id === store.ui.selectedGameId),
    [store.games, store.ui.selectedGameId]
  );

  const [tab, setTab] = useState<"roster" | "games" | "game">("games");

  useEffect(() => {
    if (selectedGame) setTab("game");
  }, [selectedGame?.id]);

  // ----- Roster UI -----
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPlayerJersey, setNewPlayerJersey] = useState("");

  const addPlayer = () => {
    const name = newPlayerName.trim();
    if (!name) return;
    setStore((s) => ({
      ...s,
      players: [...s.players, { id: uid("p"), name, jersey: newPlayerJersey.trim() || undefined }],
    }));
    setNewPlayerName("");
    setNewPlayerJersey("");
  };

  const deletePlayer = (id: Id) => {
    setStore((s) => ({
      ...s,
      players: s.players.filter((p) => p.id !== id),
      games: s.games.map((g) => ({
        ...g,
        events: g.events.filter((e) => e.playerId !== id && e.receiverId !== id),
      })),
    }));
  };

  // ----- Games UI -----
  const [opponent, setOpponent] = useState("");
  const [dateISO, setDateISO] = useState(() => new Date().toISOString().slice(0, 10));
  const [ruleSet, setRuleSet] = useState<RuleSet>("NFL_FLAG");

  const addGame = () => {
    const opp = opponent.trim();
    if (!opp) return;
    const game: Game = { id: uid("g"), opponent: opp, dateISO, ruleSet, events: [] };
    setStore((s) => ({
      ...s,
      games: [game, ...s.games],
      ui: { ...s.ui, selectedGameId: game.id },
    }));
    setOpponent("");
  };

  const openGame = (id: Id) => {
    setStore((s) => ({ ...s, ui: { ...s.ui, selectedGameId: id } }));
  };

  const deleteGame = (id: Id) => {
    setStore((s) => ({
      ...s,
      games: s.games.filter((g) => g.id !== id),
      ui: { ...s.ui, selectedGameId: s.ui.selectedGameId === id ? undefined : s.ui.selectedGameId },
    }));
    setTab("games");
  };

  // ----- In-game quick logging -----
  const [primaryPlayerId, setPrimaryPlayerId] = useState<Id>(store.players[0]?.id ?? "");
  const [receiverId, setReceiverId] = useState<Id>(store.players[0]?.id ?? "");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!primaryPlayerId && store.players[0]?.id) setPrimaryPlayerId(store.players[0].id);
    if (!receiverId && store.players[0]?.id) setReceiverId(store.players[0].id);
  }, [store.players, primaryPlayerId, receiverId]);

  const pushEvent = (type: EventType, opts?: Partial<StatEvent>) => {
    if (!selectedGame) return;
    if (!primaryPlayerId) return;
    const event: StatEvent = {
      id: uid("e"),
      ts: Date.now(),
      type,
      playerId: primaryPlayerId,
      receiverId: opts?.receiverId,
      yards: opts?.yards,
      note: (opts?.note ?? note).trim() || undefined,
    };
    setStore((s) => ({
      ...s,
      games: s.games.map((g) => (g.id === selectedGame.id ? { ...g, events: [event, ...g.events] } : g)),
    }));
    setNote("");
  };

  const removeEvent = (eventId: Id) => {
    if (!selectedGame) return;
    setStore((s) => ({
      ...s,
      games: s.games.map((g) => (g.id === selectedGame.id ? { ...g, events: g.events.filter((e) => e.id !== eventId) } : g)),
    }));
  };

  const clearGameEvents = () => {
    if (!selectedGame) return;
    setStore((s) => ({
      ...s,
      games: s.games.map((g) => (g.id === selectedGame.id ? { ...g, events: [] } : g)),
    }));
  };

  const statsByPlayer = useMemo(() => {
    if (!selectedGame) return {} as Record<string, PlayerStats>;
    return computeStats(store.players, selectedGame.events);
  }, [store.players, selectedGame?.events, selectedGame?.id]);

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "flag5v5-stats.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = async (file: File) => {
    const text = await file.text();
    const parsed = JSON.parse(text) as Store;
    setStore({
      players: Array.isArray(parsed.players) ? parsed.players : [],
      games: Array.isArray(parsed.games)
      ? parsed.games.map((g: any) => ({
          ...g,
          ruleSet: (g?.ruleSet as RuleSet) || "NFL_FLAG",
          events: Array.isArray(g?.events) ? g.events : [],
        }))
      : [],
      ui: parsed.ui ?? {},
    });
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-2xl font-bold tracking-tight">5v5 Flag Football Stat Tracker</div>
            <div className="text-sm text-neutral-600">Tap-to-log offensive + defensive player stats. Offline-first.</div>
          </div>
          <div className="flex items-center gap-2">
            <Btn variant={tab === "games" ? "primary" : "ghost"} onClick={() => setTab("games")}>
              Games
            </Btn>
            <Btn variant={tab === "roster" ? "primary" : "ghost"} onClick={() => setTab("roster")}>
              Roster
            </Btn>
            <Btn variant="ghost" onClick={exportJSON} title="Export all data as JSON">
              Export
            </Btn>
            <label className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium hover:bg-neutral-50 cursor-pointer">
              Import
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importJSON(f);
                }}
              />
            </label>
          </div>
        </header>

        {/* Games */}
        {tab === "games" && (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardBody>
                <SectionTitle>New game</SectionTitle>
                <div className="mt-3 space-y-2">
                  <div>
                    <div className="mb-1 text-xs font-medium text-neutral-600">Opponent</div>
                    <Input value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="e.g., Tigers" />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-neutral-600">Date</div>
                    <Input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-neutral-600">Rules</div>
                    <Select value={ruleSet} onChange={(e) => setRuleSet(e.target.value as RuleSet)}>
                      <option value="NFL_FLAG">NFL FLAG</option>
                      <option value="NEXT_LEVEL">Next Level</option>
                      <option value="FARM_LEAGUE">Farm League</option>
                    </Select>
                    <div className="mt-1 text-xs text-neutral-600">
                      PAT: {RULESET_HELP[ruleSet].pat1} • {RULESET_HELP[ruleSet].pat2}
                    </div>
                  </div>
                  <Btn onClick={addGame} disabled={!opponent.trim()}>
                    Create game
                  </Btn>
                  <div className="text-xs text-neutral-600">
                    Tip: Build your roster first so you can log plays faster.
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardBody>
                <SectionTitle>Games</SectionTitle>
                <div className="mt-3 space-y-2">
                  {store.games.length === 0 ? (
                    <div className="text-sm text-neutral-600">No games yet.</div>
                  ) : (
                    store.games.map((g) => (
                      <div key={g.id} className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-3">
                        <div>
                          <div className="font-semibold">vs {g.opponent}</div>
                          <div className="text-xs text-neutral-600">{fmtDate(g.dateISO)} • {RULESET_LABEL[g.ruleSet]} • {g.events.length} events</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Btn variant="ghost" onClick={() => openGame(g.id)}>
                            Open
                          </Btn>
                          <Btn
                            variant="danger"
                            onClick={() => deleteGame(g.id)}
                            title="Delete game"
                          >
                            Delete
                          </Btn>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardBody>
            </Card>
          </div>
        )}

        {/* Roster */}
        {tab === "roster" && (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardBody>
                <SectionTitle>Add player</SectionTitle>
                <div className="mt-3 space-y-2">
                  <div>
                    <div className="mb-1 text-xs font-medium text-neutral-600">Name</div>
                    <Input value={newPlayerName} onChange={(e) => setNewPlayerName(e.target.value)} placeholder="e.g., Brayden" />
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-neutral-600">Jersey (optional)</div>
                    <Input value={newPlayerJersey} onChange={(e) => setNewPlayerJersey(e.target.value)} placeholder="#7" />
                  </div>
                  <Btn onClick={addPlayer} disabled={!newPlayerName.trim()}>
                    Add
                  </Btn>
                </div>
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardBody>
                <SectionTitle>Roster</SectionTitle>
                <div className="mt-3 space-y-2">
                  {store.players.length === 0 ? (
                    <div className="text-sm text-neutral-600">No players yet.</div>
                  ) : (
                    store.players.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-3">
                        <div>
                          <div className="font-semibold">{p.name} {p.jersey ? <span className="text-neutral-500">({p.jersey})</span> : null}</div>
                          <div className="text-xs text-neutral-600">id: {p.id}</div>
                        </div>
                        <Btn variant="danger" onClick={() => deletePlayer(p.id)} title="Delete player (removes their events across all games)">
                          Delete
                        </Btn>
                      </div>
                    ))
                  )}
                </div>
              </CardBody>
            </Card>
          </div>
        )}

        {/* Game view */}
        {tab === "game" && selectedGame && (
          <div className="mt-6 space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xl font-bold">Game: vs {selectedGame.opponent}</div>
                <div className="text-sm text-neutral-600">{fmtDate(selectedGame.dateISO)} • {RULESET_LABEL[selectedGame.ruleSet]} • {selectedGame.events.length} events</div>
              </div>
              <div className="flex items-center gap-2">
                <Btn variant="ghost" onClick={() => setTab("games")}>Back to games</Btn>
                <Btn variant="danger" onClick={clearGameEvents} disabled={selectedGame.events.length === 0}>Clear events</Btn>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Quick logger */}
              <Card className="lg:col-span-1">
                <CardBody>
                  <SectionTitle>Quick log</SectionTitle>

                  {store.players.length === 0 ? (
                    <div className="mt-3 text-sm text-neutral-600">Add players in Roster first.</div>
                  ) : (
                    <>
                      <div className="mt-3 space-y-2">
                        <div>
                          <div className="mb-1 text-xs font-medium text-neutral-600">Primary player</div>
                          <Select value={primaryPlayerId} onChange={(e) => setPrimaryPlayerId(e.target.value)}>
                            {store.players.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}{p.jersey ? ` (${p.jersey})` : ""}
                              </option>
                            ))}
                          </Select>
                        </div>

                        <div>
                          <div className="mb-1 text-xs font-medium text-neutral-600">Receiver (for completions/TD passes)</div>
                          <Select value={receiverId} onChange={(e) => setReceiverId(e.target.value)}>
                            {store.players.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}{p.jersey ? ` (${p.jersey})` : ""}
                              </option>
                            ))}
                          </Select>
                        </div>

                        <div>
                          <div className="mb-1 text-xs font-medium text-neutral-600">Note (optional)</div>
                          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g., 4th down stop" />
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="text-xs font-medium text-neutral-600">Passing</div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Btn variant="ghost" onClick={() => pushEvent("PASS_ATT")}>Pass Att</Btn>
                          <Btn onClick={() => pushEvent("PASS_COMP", { receiverId })}>Complete</Btn>
                          <Btn onClick={() => pushEvent("PASS_TD", { receiverId })}>Pass TD</Btn>
                          <Btn variant="danger" onClick={() => pushEvent("INT_THROWN")}>INT Thrown</Btn>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="text-xs font-medium text-neutral-600">Rushing / Receiving</div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Btn variant="ghost" onClick={() => pushEvent("RUSH_ATT")}>Rush Att</Btn>
                          <Btn onClick={() => pushEvent("RUSH_TD")}>Rush TD</Btn>
                          <Btn variant="ghost" onClick={() => pushEvent("REC")}>Reception</Btn>
                          <Btn onClick={() => pushEvent("REC_TD")}>Rec TD</Btn>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="text-xs font-medium text-neutral-600">Defense</div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Btn onClick={() => pushEvent("FLAG_PULL")}>Flag Pull</Btn>
                          <Btn onClick={() => pushEvent("SACK")}>Sack</Btn>
                          <Btn onClick={() => pushEvent("DEF_INT")}>INT</Btn>
                          <Btn onClick={() => pushEvent("DEF_TD")}>Def TD</Btn>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="text-xs font-medium text-neutral-600">PAT</div>
                        <div className="mt-1 text-xs text-neutral-600">
                          {RULESET_HELP[selectedGame.ruleSet].pat1} • {RULESET_HELP[selectedGame.ruleSet].pat2}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Btn onClick={() => pushEvent("XP_1")}>+1</Btn>
                          <Btn onClick={() => pushEvent("XP_2")}>+2</Btn>
                          {RULESET_CONFIG[selectedGame.ruleSet].allowPatReturn ? (
                            <Btn variant="danger" onClick={() => pushEvent("PAT_RET_2")}>
                              PAT Return +2
                            </Btn>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4 text-xs text-neutral-600">
                        You can customize these buttons to match your league rules (rush line, no-run zones, etc.).
                      </div>
                    </>
                  )}
                </CardBody>
              </Card>

              {/* Stats table */}
              <Card className="lg:col-span-2">
                <CardBody>
                  <SectionTitle>Player stats</SectionTitle>
                  <div className="mt-3 overflow-auto rounded-xl border border-neutral-200 bg-white">
                    <table className="min-w-full text-sm">
                      <thead className="bg-neutral-50 text-neutral-600">
                        <tr>
                          <th className="px-3 py-2 text-left">Player</th>
                          <th className="px-3 py-2 text-right">P/C-A</th>
                          <th className="px-3 py-2 text-right">Pass TD</th>
                          <th className="px-3 py-2 text-right">INT</th>
                          <th className="px-3 py-2 text-right">Rush</th>
                          <th className="px-3 py-2 text-right">Rush TD</th>
                          <th className="px-3 py-2 text-right">Rec</th>
                          <th className="px-3 py-2 text-right">Rec TD</th>
                          <th className="px-3 py-2 text-right">FP</th>
                          <th className="px-3 py-2 text-right">Sack</th>
                          <th className="px-3 py-2 text-right">Def INT</th>
                          <th className="px-3 py-2 text-right">Def TD</th>
                          <th className="px-3 py-2 text-right">XP1</th>
                          <th className="px-3 py-2 text-right">XP2</th>
                          <th className="px-3 py-2 text-right">PAT RTN</th>
                          <th className="px-3 py-2 text-right">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {store.players.map((p) => {
                          const s = statsByPlayer[p.id] ?? emptyStats();
                          return (
                            <tr key={p.id} className="border-t border-neutral-200">
                              <td className="px-3 py-2 font-medium">{p.name}{p.jersey ? ` (${p.jersey})` : ""}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{s.passComp}-{s.passAtt}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{s.passTD}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{s.intThrown}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{s.rushAtt}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{s.rushTD}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{s.rec}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{s.recTD}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{s.flagPulls}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{s.sacks}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{s.defInt}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{s.defTD}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{s.xp1}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{s.xp2}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{s.patRet2}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold">{s.points}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 text-xs text-neutral-600">
                    P/C-A = Pass Completions - Attempts. FP = Flag Pulls.
                  </div>
                </CardBody>
              </Card>
            </div>

            {/* Event log */}
            <Card>
              <CardBody>
                <SectionTitle>Event log (latest first)</SectionTitle>
                <div className="mt-3 space-y-2">
                  {selectedGame.events.length === 0 ? (
                    <div className="text-sm text-neutral-600">No events yet. Use Quick log to start tracking.</div>
                  ) : (
                    selectedGame.events.map((e) => {
                      const p = playersById[e.playerId];
                      const r = e.receiverId ? playersById[e.receiverId] : undefined;
                      const label = (() => {
                        switch (e.type) {
                          case "PASS_ATT":
                            return "Pass attempt";
                          case "PASS_COMP":
                            return `Completion${r ? ` → ${r.name}` : ""}`;
                          case "PASS_TD":
                            return `Pass TD${r ? ` → ${r.name}` : ""}`;
                          case "INT_THROWN":
                            return "Interception thrown";
                          case "RUSH_ATT":
                            return "Rush attempt";
                          case "RUSH_TD":
                            return "Rush TD";
                          case "REC":
                            return "Reception";
                          case "REC_TD":
                            return "Receiving TD";
                          case "DEF_INT":
                            return "Defensive INT";
                          case "SACK":
                            return "Sack";
                          case "FLAG_PULL":
                            return "Flag pull";
                          case "DEF_TD":
                            return "Defensive TD";
                          case "XP_1":
                            return "Extra point (1)";
                          case "XP_2":
                            return "Extra point (2)";
                          case "PAT_RET_2":
                            return "PAT return for 2";
                          default:
                            return e.type;
                        }
                      })();

                      return (
                        <div key={e.id} className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-3">
                          <div>
                            <div className="font-medium">
                              {p ? p.name : "Unknown"}: {label}
                            </div>
                            <div className="text-xs text-neutral-600">
                              {new Date(e.ts).toLocaleTimeString()} {e.note ? `• ${e.note}` : ""}
                            </div>
                          </div>
                          <Btn variant="danger" onClick={() => removeEvent(e.id)}>
                            Remove
                          </Btn>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardBody>
            </Card>
          </div>
        )}

        {/* Footer */}
        <div className="mt-10 text-xs text-neutral-500">
          MVP notes: This version is single-user and stores data locally. Next upgrades: login, team seasons, multi-device sync (Supabase/Firebase), play-by-play with down/distance, and PDF box score exports.
        </div>
      </div>
    </div>
  );
}
