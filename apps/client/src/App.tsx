import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  GameRuntime,
  GloveId,
  KnifeId,
  KnifeFinish,
  RuntimeStatus,
  RuntimeTelemetry,
} from "./game/GameRuntime";
import {
  GLOVE_CATALOG,
  KNIFE_CATALOG,
  getKnifeName,
} from "./game/viewmodelCatalog";
import {
  CROSSHAIR_CONFIG,
  type CrosshairSettings,
} from "./game/crosshairConfig";
import { VIEWMODEL_POSITION_CONFIG } from "./game/viewmodelConfig";
import {
  loadPlayerSettings,
  resetPlayerSettings,
  savePlayerSettings,
  type PlayerSettings,
  type QualityLevel,
} from "./game/playerSettings";

type MenuSection = "home" | "maps" | "loadout" | "cases" | "settings";
type LoadoutCategory = "knives" | "gloves" | "finishes";
type ViewmodelAxis = "x" | "y" | "z";
type SettingsCategory = "controls" | "video" | "audio" | "hud" | "viewmodel";

type RuntimeModule = typeof import("./game/GameRuntime");
let runtimeModulePromise: Promise<RuntimeModule> | null = null;
const loadRuntimeModule = (): Promise<RuntimeModule> => {
  runtimeModulePromise ??= import("./game/GameRuntime");
  return runtimeModulePromise;
};

const INITIAL_TELEMETRY: RuntimeTelemetry = {
  status: "ready",
  elapsedSeconds: 0,
  speedUps: 0,
  verticalSpeedUps: 0,
  grounded: false,
  surfing: false,
  fps: 0,
  tick: 0,
  checkpoint: 0,
  checkpointCount: 0,
  profileId: "community-autobhop-surf-v0",
  bestSeconds: null,
};

const MENU_ITEMS: ReadonlyArray<{ id: MenuSection; label: string; index: string }> = [
  { id: "home", label: "Играть", index: "01" },
  { id: "maps", label: "Карты", index: "02" },
  { id: "loadout", label: "Снаряжение", index: "03" },
  { id: "cases", label: "Кейсы", index: "04" },
  { id: "settings", label: "Настройки", index: "05" },
];

const LOADOUT_CATEGORIES: readonly LoadoutCategory[] = ["knives", "gloves", "finishes"];
const SETTINGS_CATEGORIES: ReadonlyArray<{ id: SettingsCategory; label: string }> = [
  { id: "controls", label: "Управление" },
  { id: "video", label: "Изображение" },
  { id: "audio", label: "Звук" },
  { id: "hud", label: "HUD и прицел" },
  { id: "viewmodel", label: "Положение рук" },
];

const KNIFE_FINISHES: ReadonlyArray<{
  id: KnifeFinish;
  name: string;
  subtitle: string;
  color: string;
}> = [
  { id: "default", name: "Заводская", subtitle: "Исходный материал модели", color: "#aeb7bd" },
];

const formatTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainingSeconds
    .toFixed(3)
    .padStart(6, "0")}`;
};

const formatOffset = (value: number): string =>
  `${value > 0 ? "+" : ""}${value}`;

const Crosshair = ({
  style,
  preview = false,
}: {
  style: CrosshairSettings["style"];
  preview?: boolean;
}) => (
  <div
    className={`crosshair crosshair--${style}${preview ? " crosshair--preview" : ""}`}
    role={preview ? "img" : undefined}
    aria-label={preview ? "Предпросмотр прицела" : undefined}
    aria-hidden={preview ? undefined : true}
  >
    <span className="crosshair__dot" />
    <span className="crosshair__line crosshair__line--left" />
    <span className="crosshair__line crosshair__line--right" />
    <span className="crosshair__line crosshair__line--top" />
    <span className="crosshair__line crosshair__line--bottom" />
  </div>
);

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const runtimeInitializationRef = useRef<Promise<GameRuntime> | null>(null);
  const menuContentRef = useRef<HTMLDivElement>(null);
  const hasNavigatedMenuRef = useRef(false);
  const [status, setStatus] = useState<RuntimeStatus>("ready");
  const [telemetry, setTelemetry] = useState<RuntimeTelemetry>(INITIAL_TELEMETRY);
  const [menuSection, setMenuSection] = useState<MenuSection>("home");
  const [debugVisible, setDebugVisible] = useState(false);
  const [knifeFinish, setKnifeFinish] = useState<KnifeFinish>("default");
  const [loadoutCategory, setLoadoutCategory] =
    useState<LoadoutCategory>("knives");
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("controls");
  const [settings, setSettings] = useState<PlayerSettings>(() =>
    loadPlayerSettings(window.localStorage));
  const [viewmodelLoadState, setViewmodelLoadState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const { fov, sensitivity } = settings.controls;
  const hudScale = settings.hud.scale;
  const crosshair = settings.hud.crosshair;
  const viewmodelOffset = settings.viewmodel.offset;
  const knifeId = settings.viewmodel.knifeId;
  const gloveId = settings.viewmodel.gloveId;

  useEffect(() => () => {
    runtimeRef.current?.dispose();
    runtimeRef.current = null;
  }, []);

  useEffect(() => {
    const startPreload = () => { void loadRuntimeModule(); };
    let idleHandle: number | null = null;
    const delayHandle = window.setTimeout(() => {
      idleHandle = window.requestIdleCallback(startPreload, { timeout: 4_000 });
    }, 1_500);
    return () => {
      window.clearTimeout(delayHandle);
      if (idleHandle !== null) window.cancelIdleCallback(idleHandle);
    };
  }, []);

  useEffect(() => {
    savePlayerSettings(window.localStorage, settings);
  }, [settings]);

  useEffect(() => {
    if (!hasNavigatedMenuRef.current) {
      hasNavigatedMenuRef.current = true;
      return;
    }
    menuContentRef.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [menuSection]);

  useEffect(() => {
    const onDebugToggle = (event: KeyboardEvent) => {
      if (event.code === "F3") {
        event.preventDefault();
        setDebugVisible((current) => !current);
      }
    };
    window.addEventListener("keydown", onDebugToggle);
    return () => window.removeEventListener("keydown", onDebugToggle);
  }, []);

  const createRuntime = async (): Promise<GameRuntime> => {
    if (runtimeRef.current) return runtimeRef.current;
    if (runtimeInitializationRef.current) return runtimeInitializationRef.current;
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("Игровой canvas недоступен");

    setStatus("loading");
    setError(null);
    const initialization = loadRuntimeModule().then(async ({ GameRuntime: RuntimeConstructor }) => {
      const runtime = new RuntimeConstructor(
        canvas,
        { onTelemetry: setTelemetry, onStatus: setStatus },
        {
          fov: settings.controls.fov,
          mouseSensitivity: settings.controls.sensitivity / 1000,
          autoBhop: settings.controls.autoBhop,
          shadows: settings.video.shadows,
          pixelRatio: settings.video.pixelRatio,
          antialias: settings.video.antialias,
          fpsLimit: settings.video.fpsLimit,
          gameVolume: settings.audio.gameVolume / 100,
          knifeId: settings.viewmodel.knifeId,
          gloveId: settings.viewmodel.gloveId,
          knifeFinish,
          viewmodelOffset: settings.viewmodel.offset,
        },
      );
      runtimeRef.current = runtime;
      await runtime.initialize();
      return runtime;
    });
    runtimeInitializationRef.current = initialization;
    try {
      return await initialization;
    } finally {
      runtimeInitializationRef.current = null;
    }
  };

  const start = () => {
    void createRuntime()
      .then((runtime) => runtime.start())
      .catch((initializationError: unknown) => {
        runtimeRef.current?.dispose();
        runtimeRef.current = null;
        setStatus("ready");
        setError(
          initializationError instanceof Error
            ? initializationError.message
            : "Не удалось инициализировать игровой runtime",
        );
      });
  };
  const restart = () => {
    runtimeRef.current?.reset();
    runtimeRef.current?.start();
  };
  const returnToMenu = () => {
    setMenuSection("home");
    runtimeRef.current?.returnToMenu();
  };
  const selectKnifeFinish = (finish: KnifeFinish) => {
    setKnifeFinish(finish);
    runtimeRef.current?.setKnifeFinish(finish);
  };
  const selectKnife = (knife: KnifeId) => {
    setSettings((current) => ({
      ...current,
      viewmodel: { ...current.viewmodel, knifeId: knife },
    }));
    if (runtimeRef.current) {
      setViewmodelLoadState("loading");
      void runtimeRef.current.setKnifeModel(knife).then(
        () => setViewmodelLoadState("loaded"),
        (loadError: unknown) => {
          setViewmodelLoadState("error");
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить нож");
        },
      );
    }
  };
  const selectGloves = (gloves: GloveId) => {
    setSettings((current) => ({
      ...current,
      viewmodel: { ...current.viewmodel, gloveId: gloves },
    }));
    if (runtimeRef.current) {
      setViewmodelLoadState("loading");
      void runtimeRef.current.setGloveModel(gloves).then(
        () => setViewmodelLoadState("loaded"),
        (loadError: unknown) => {
          setViewmodelLoadState("error");
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить перчатки");
        },
      );
    }
  };
  const updateFov = (value: number) => {
    setSettings((current) => ({
      ...current,
      controls: { ...current.controls, fov: value },
    }));
    runtimeRef.current?.setFov(value);
  };
  const updateSensitivity = (value: number) => {
    setSettings((current) => ({
      ...current,
      controls: { ...current.controls, sensitivity: value },
    }));
    runtimeRef.current?.setMouseSensitivity(value / 1000);
  };
  const updateViewmodelOffset = (axis: ViewmodelAxis, value: number) => {
    setSettings((current) => {
      const next = { ...current.viewmodel.offset, [axis]: value };
      runtimeRef.current?.setViewmodelOffset(next.x, next.y, next.z);
      return {
        ...current,
        viewmodel: { ...current.viewmodel, offset: next },
      };
    });
  };
  const updateCrosshair = <Key extends keyof CrosshairSettings>(
    key: Key,
    value: CrosshairSettings[Key],
  ) => {
    setSettings((current) => ({
      ...current,
      hud: {
        ...current.hud,
        crosshair: { ...current.hud.crosshair, [key]: value },
      },
    }));
  };
  const resetSettings = () => {
    const defaults = resetPlayerSettings(window.localStorage);
    setSettings(defaults);
    runtimeRef.current?.setFov(defaults.controls.fov);
    runtimeRef.current?.setMouseSensitivity(defaults.controls.sensitivity / 1000);
    runtimeRef.current?.setAutoBhop(defaults.controls.autoBhop);
    runtimeRef.current?.setGameVolume(defaults.audio.gameVolume / 100);
    runtimeRef.current?.setGraphics(defaults.video);
    void runtimeRef.current?.setKnifeModel(defaults.viewmodel.knifeId).catch(
      (loadError: unknown) => setError(
        loadError instanceof Error ? loadError.message : "Не удалось сбросить модель ножа",
      ),
    );
    void runtimeRef.current?.setGloveModel(defaults.viewmodel.gloveId).catch(
      (loadError: unknown) => setError(
        loadError instanceof Error ? loadError.message : "Не удалось сбросить модель перчаток",
      ),
    );
    runtimeRef.current?.setViewmodelOffset(
      defaults.viewmodel.offset.x,
      defaults.viewmodel.offset.y,
      defaults.viewmodel.offset.z,
    );
  };

  const updateVideo = <Key extends keyof PlayerSettings["video"]>(
    key: Key,
    value: PlayerSettings["video"][Key],
  ) => {
    setSettings((current) => ({
      ...current,
      video: { ...current.video, [key]: value },
    }));
    if (key === "shadows" || key === "pixelRatio" || key === "fpsLimit") {
      runtimeRef.current?.setGraphics({ [key]: value });
    }
  };

  const onLoadoutTabKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (![
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
    ].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = LOADOUT_CATEGORIES.indexOf(loadoutCategory);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? LOADOUT_CATEGORIES.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1)
          + LOADOUT_CATEGORIES.length) % LOADOUT_CATEGORIES.length;
    const next = LOADOUT_CATEGORIES[nextIndex];
    if (!next) return;
    setLoadoutCategory(next);
    document.getElementById(`loadout-tab-${next}`)?.focus();
  };

  const shellStyle = {
    "--hud-scale": hudScale / 100,
    "--crosshair-color": crosshair.color,
    "--crosshair-dot-size": `${crosshair.dotSize}px`,
    "--crosshair-line-length": `${crosshair.lineLength}px`,
    "--crosshair-thickness": `${crosshair.thickness}px`,
    "--crosshair-gap": `${crosshair.gap}px`,
    "--crosshair-opacity": crosshair.opacity / 100,
  } as CSSProperties;

  return (
    <main className="game-shell" style={shellStyle}>
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label="Игровая сцена Parkour Flow"
        tabIndex={-1}
      />
      <div className="ambient-vignette" aria-hidden="true" />

      {status === "running" && (
        <div className="hud">
          <section className="cs-radar" aria-label="Схема маршрута">
            <div className="cs-radar__grid" aria-hidden="true">
              <span className="cs-radar__route" />
              <span className="cs-radar__player" />
              <i className="cs-radar__point cs-radar__point--one" />
              <i className="cs-radar__point cs-radar__point--two" />
              <i className="cs-radar__point cs-radar__point--three" />
            </div>
            <strong>FLOW CALIBRATION</strong>
            <span>Точка {telemetry.checkpoint}/{telemetry.checkpointCount}</span>
          </section>

          <section className="cs-scorebar" aria-label="Время и прогресс забега">
            <div className="cs-score cs-score--left">
              <span>FLOW</span>
              <strong>{String(telemetry.checkpoint).padStart(2, "0")}</strong>
            </div>
            <div className="cs-round-clock">
              <span>ЗАБЕГ</span>
              <output>{formatTime(telemetry.elapsedSeconds)}</output>
            </div>
            <div className="cs-score cs-score--right">
              <strong>{String(telemetry.checkpointCount).padStart(2, "0")}</strong>
              <span>FINISH</span>
            </div>
          </section>

          <div className="cs-run-status">
            <span className="assist-dot" aria-hidden="true" />
            AUTO-BHOP
            <small>
              PB {telemetry.bestSeconds === null ? "—" : formatTime(telemetry.bestSeconds)}
            </small>
          </div>

          <section className="speed-card" aria-label="Горизонтальная скорость">
            <span className="speed-value">{Math.round(telemetry.speedUps)}</span>
            <span className="speed-unit">UPS</span>
            <span className="speed-rule" />
          </section>

          <Crosshair style={crosshair.style} />

          <section className="cs-vitals" aria-label="Состояние игрока">
            <div className="cs-health-icon" aria-hidden="true" />
            <strong>100</strong>
            <span className="cs-armor-icon" aria-hidden="true" />
            <strong>100</strong>
            <output>$ 2 400</output>
          </section>

          <section className="cs-weapon" aria-label="Текущее оружие">
            <span className="cs-weapon__slots">1 <b>2</b> <b>3</b></span>
            <strong>{getKnifeName(knifeId)}</strong>
            <small><kbd>ЛКМ</kbd> УДАР · <kbd>ПКМ</kbd> СИЛЬНЫЙ · <kbd>F</kbd> ОСМОТР</small>
            <span className="cs-knife-mark" aria-hidden="true" />
          </section>

          {debugVisible && (
            <aside className="debug-panel" aria-label="Диагностика движения">
              <div className="debug-heading">
                <span>SIM TRACE</span>
                <span className={telemetry.grounded ? "signal signal--on" : "signal"} />
              </div>
              <dl>
                <div><dt>FPS</dt><dd>{Math.round(telemetry.fps)}</dd></div>
                <div><dt>TICK</dt><dd>{telemetry.tick}</dd></div>
                <div><dt>VERT</dt><dd>{Math.round(telemetry.verticalSpeedUps)} ups</dd></div>
                <div>
                  <dt>STATE</dt>
                  <dd>
                    {telemetry.surfing
                      ? "SURF PLANE"
                      : telemetry.grounded
                        ? "GROUND"
                        : "AIR"}
                  </dd>
                </div>
                <div><dt>PROFILE</dt><dd>{telemetry.profileId}</dd></div>
              </dl>
            </aside>
          )}
        </div>
      )}

      {status === "loading" && (
        <section className="loading-layer" aria-live="polite">
          <span className="brand-mark brand-mark--large" aria-hidden="true"><i /><i /><i /></span>
          <span className="phase-label">ИНИЦИАЛИЗАЦИЯ MOVEMENT LAB</span>
          <strong>Загрузка игрового runtime…</strong>
        </section>
      )}

      {error && (
        <section className="loading-layer" role="alert">
          <span className="phase-label">RUNTIME ERROR</span>
          <strong>Запуск не удался</strong>
          <p>{error}</p>
          <button
            className="secondary-action"
            type="button"
            onClick={() => setError(null)}
          >
            ВЕРНУТЬСЯ В МЕНЮ
          </button>
        </section>
      )}

      {status === "ready" && !error && (
        <section className="menu-layer">
          <header className="menu-topbar">
            <div className="menu-brand">
              <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
              <span>PARKOUR FLOW</span>
              <small>PRE-ALPHA 0.4</small>
            </div>
            <div className="profile-cluster">
              <span className="wallet"><small>DEMO</small> 2 400 PF</span>
              <span className="player-badge">GUEST_01</span>
            </div>
          </header>

          <nav className="menu-nav" aria-label="Главное меню">
            {MENU_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={menuSection === item.id ? "menu-nav-item is-active" : "menu-nav-item"}
                aria-current={menuSection === item.id ? "page" : undefined}
                onClick={() => setMenuSection(item.id)}
              >
                <span>{item.index}</span>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="menu-content" ref={menuContentRef}>
            {menuSection === "home" && (
              <section className="home-panel">
                <div className="home-copy">
                  <span className="phase-label">SINGLE PLAYER · MOVEMENT LAB</span>
                  <h1 tabIndex={-1}>Поймай ритм.<br /><em>Сохрани скорость.</em></h1>
                  <p>
                    Облегчённая тестовая трасса: широкие bhop-платформы,
                    мягкие surf-рампы и возврат на последний чекпоинт.
                  </p>
                  <button className="primary-action" type="button" onClick={start}>
                    <span>НАЧАТЬ ЗАБЕГ</span>
                    <span className="action-arrow" aria-hidden="true">→</span>
                  </button>
                  <div className="quick-controls">
                    <span><kbd>WASD</kbd> движение</span>
                    <span><kbd>SPACE</kbd> auto-bhop</span>
                    <span><kbd>ЛКМ</kbd> серия ударов</span>
                    <span><kbd>ПКМ</kbd> сильный удар</span>
                    <span><kbd>R</kbd> рестарт</span>
                    <span><kbd>F</kbd> осмотр ножа</span>
                  </div>
                </div>

                <article className="map-feature-card">
                  <div className="map-visual" aria-hidden="true">
                    <span className="map-gate" />
                    <span className="map-pad map-pad--one" />
                    <span className="map-pad map-pad--two" />
                    <span className="map-pad map-pad--three" />
                    <strong>01</strong>
                  </div>
                  <div className="map-card-body">
                    <span className="eyebrow">ТЕКУЩАЯ КАРТА</span>
                    <h2>Flow Calibration</h2>
                    <div className="tag-row"><span>BHOP</span><span>SURF</span><span>EASY</span></div>
                    <dl>
                      <div><dt>Чекпоинты</dt><dd>3</dd></div>
                      <div><dt>Лучшее время</dt><dd>{telemetry.bestSeconds === null ? "—" : formatTime(telemetry.bestSeconds)}</dd></div>
                    </dl>
                  </div>
                </article>
              </section>
            )}

            {menuSection === "maps" && (
              <section className="section-panel">
                <div className="section-heading">
                  <span className="phase-label">КАТАЛОГ КАРТ</span>
                  <h1 tabIndex={-1}>Выбери маршрут</h1>
                  <p>Сейчас открыт первый вертикальный срез. Следующие карты появятся после калибровки движения.</p>
                </div>
                <div className="map-grid">
                  <button className="route-card route-card--active" type="button" onClick={start}>
                    <span className="route-number">01</span>
                    <span className="route-state">ДОСТУПНО</span>
                    <strong>Flow Calibration</strong>
                    <small>Bhop + Surf · Easy · 3 checkpoints</small>
                  </button>
                  <div className="route-card is-locked">
                    <span className="route-number">02</span>
                    <span className="route-state">В РАЗРАБОТКЕ</span>
                    <strong>Quiet Skyline</strong>
                    <small>Pure Bhop · Medium</small>
                  </div>
                  <div className="route-card is-locked">
                    <span className="route-number">03</span>
                    <span className="route-state">В РАЗРАБОТКЕ</span>
                    <strong>Glass Current</strong>
                    <small>Pure Surf · Medium</small>
                  </div>
                </div>
              </section>
            )}

            {menuSection === "loadout" && (
              <section className="section-panel loadout-panel">
                <div className="section-heading">
                  <span className="phase-label">СНАРЯЖЕНИЕ</span>
                  <h1 tabIndex={-1}>Инвентарь</h1>
                  <p>{KNIFE_CATALOG.length} модели ножей и {GLOVE_CATALOG.length} комплектов рук. Выбранный предмет лениво загружается и сразу применяется к viewmodel.</p>
                </div>

                <div
                  className="loadout-tabs"
                  role="tablist"
                  aria-label="Категория снаряжения"
                  onKeyDown={onLoadoutTabKeyDown}
                >
                  <button
                    id="loadout-tab-knives"
                    type="button"
                    role="tab"
                    aria-selected={loadoutCategory === "knives"}
                    aria-controls="loadout-panel-knives"
                    tabIndex={loadoutCategory === "knives" ? 0 : -1}
                    className={loadoutCategory === "knives" ? "is-active" : ""}
                    onClick={() => setLoadoutCategory("knives")}
                  >НОЖИ <span>{KNIFE_CATALOG.length}</span></button>
                  <button
                    id="loadout-tab-gloves"
                    type="button"
                    role="tab"
                    aria-selected={loadoutCategory === "gloves"}
                    aria-controls="loadout-panel-gloves"
                    tabIndex={loadoutCategory === "gloves" ? 0 : -1}
                    className={loadoutCategory === "gloves" ? "is-active" : ""}
                    onClick={() => setLoadoutCategory("gloves")}
                  >ПЕРЧАТКИ <span>{GLOVE_CATALOG.length}</span></button>
                  <button
                    id="loadout-tab-finishes"
                    type="button"
                    role="tab"
                    aria-selected={loadoutCategory === "finishes"}
                    aria-controls="loadout-panel-finishes"
                    tabIndex={loadoutCategory === "finishes" ? 0 : -1}
                    className={loadoutCategory === "finishes" ? "is-active" : ""}
                    onClick={() => setLoadoutCategory("finishes")}
                  >ОТДЕЛКИ <span>{KNIFE_FINISHES.length}</span></button>
                </div>

                {loadoutCategory === "knives" && (
                  <div
                    id="loadout-panel-knives"
                    className="inventory-grid"
                    role="tabpanel"
                    aria-labelledby="loadout-tab-knives"
                    tabIndex={0}
                  >
                    {KNIFE_CATALOG.map((knife, index) => (
                      <button
                        key={knife.id}
                        type="button"
                        className={knifeId === knife.id ? "inventory-card is-selected" : "inventory-card"}
                        aria-pressed={knifeId === knife.id}
                        onClick={() => selectKnife(knife.id)}
                      >
                        <span className="inventory-card__index">{String(index + 1).padStart(2, "0")}</span>
                        <span className="inventory-card__knife" aria-hidden="true" />
                        <strong>{knife.name}</strong>
                        <small>{knifeId === knife.id ? "ЭКИПИРОВАНО" : "ВЫБРАТЬ"}</small>
                      </button>
                    ))}
                  </div>
                )}

                <p className="asset-load-state" aria-live="polite">
                  {viewmodelLoadState === "loading" && "Загрузка выбранной модели…"}
                  {viewmodelLoadState === "loaded" && "Модель готова"}
                  {viewmodelLoadState === "error" && "Не удалось заменить модель — текущая оставлена"}
                </p>

                {loadoutCategory === "gloves" && (
                  <div
                    id="loadout-panel-gloves"
                    className="inventory-grid inventory-grid--gloves"
                    role="tabpanel"
                    aria-labelledby="loadout-tab-gloves"
                    tabIndex={0}
                  >
                    {GLOVE_CATALOG.map((gloves, index) => (
                      <button
                        key={gloves.id}
                        type="button"
                        className={gloveId === gloves.id ? "inventory-card is-selected" : "inventory-card"}
                        aria-pressed={gloveId === gloves.id}
                        onClick={() => selectGloves(gloves.id)}
                      >
                        <span className="inventory-card__index">{String(index + 1).padStart(2, "0")}</span>
                        <span className={`inventory-card__glove inventory-card__glove--${gloves.id}`} aria-hidden="true" />
                        <strong>{gloves.name}</strong>
                        <small>{gloveId === gloves.id ? "ЭКИПИРОВАНО" : gloves.subtitle}</small>
                      </button>
                    ))}
                  </div>
                )}

                {loadoutCategory === "finishes" && (
                  <div
                    id="loadout-panel-finishes"
                    className="finish-list finish-list--inventory"
                    role="tabpanel"
                    aria-labelledby="loadout-tab-finishes"
                    tabIndex={0}
                  >
                    {KNIFE_FINISHES.map((finish) => (
                      <button
                        key={finish.id}
                        type="button"
                        className={knifeFinish === finish.id ? "finish-card is-selected" : "finish-card"}
                        aria-pressed={knifeFinish === finish.id}
                        onClick={() => selectKnifeFinish(finish.id)}
                      >
                        <span className="finish-swatch" style={{ background: finish.color }} aria-hidden="true" />
                        <span><strong>{finish.name}</strong><small>{finish.subtitle}</small></span>
                        <span className="finish-status">{knifeFinish === finish.id ? "ВЫБРАНО" : "ВЫБРАТЬ"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            {menuSection === "cases" && (
              <section className="section-panel cases-panel">
                <div className="section-heading">
                  <span className="phase-label">DEMO ECONOMY</span>
                  <h1 tabIndex={-1}>Кейсы и награды</h1>
                  <p>Раздел подготовлен для следующего этапа. Настоящих платежей нет, деньги не списываются.</p>
                </div>
                <div className="case-placeholder">
                  <span className="case-code">CASE / 001</span>
                  <div className="case-object" aria-hidden="true"><i /><i /></div>
                  <h2>Flow Starter Case</h2>
                  <p>Ножевые отделки, перчатки и HUD-темы появятся после серверного ledger.</p>
                  <button type="button" disabled>СКОРО</button>
                </div>
              </section>
            )}

            {menuSection === "settings" && (
              <section className="section-panel settings-panel">
                <div className="section-heading">
                  <span className="phase-label">НАСТРОЙКИ</span>
                  <h1 tabIndex={-1}>Настройки игрока</h1>
                  <p>Параметры проверяются и сохраняются в этом браузере автоматически.</p>
                </div>
                <div className="settings-tabs" aria-label="Категория настроек">
                  {SETTINGS_CATEGORIES.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      className={settingsCategory === category.id ? "is-active" : ""}
                      aria-pressed={settingsCategory === category.id}
                      onClick={() => setSettingsCategory(category.id)}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
                <div className="settings-list">
                  {settingsCategory === "controls" && (<>
                  <div className="settings-group-label">
                    <strong>УПРАВЛЕНИЕ</strong>
                    <small>Камера и движение</small>
                  </div>
                  <label className="setting-row">
                    <span><strong>Поле зрения</strong><small>Вертикальный FOV камеры</small></span>
                    <output>{fov}°</output>
                    <input type="range" min="70" max="105" value={fov} onChange={(event) => updateFov(Number(event.target.value))} />
                  </label>
                  <label className="setting-row">
                    <span><strong>Чувствительность</strong><small>Скорость обзора мышью</small></span>
                    <output>{sensitivity.toFixed(1)}</output>
                    <input type="range" min="0.8" max="4.5" step="0.1" value={sensitivity} onChange={(event) => updateSensitivity(Number(event.target.value))} />
                  </label>
                  <label className="setting-row setting-row--toggle">
                    <span><strong>Auto-bhop</strong><small>Повторять прыжок, пока удерживается пробел</small></span>
                    <input
                      type="checkbox"
                      checked={settings.controls.autoBhop}
                      onChange={(event) => {
                        const autoBhop = event.target.checked;
                        setSettings((current) => ({ ...current, controls: { ...current.controls, autoBhop } }));
                        runtimeRef.current?.setAutoBhop(autoBhop);
                      }}
                    />
                  </label>
                  </>)}

                  {settingsCategory === "video" && (<>
                  <div className="settings-group-label">
                    <strong>ИЗОБРАЖЕНИЕ</strong>
                    <small>Баланс качества и производительности</small>
                  </div>
                  <label className="setting-row setting-row--toggle">
                    <span><strong>Тени</strong><small>Динамические тени на трассе</small></span>
                    <input type="checkbox" checked={settings.video.shadows} onChange={(event) => updateVideo("shadows", event.target.checked)} />
                  </label>
                  <label className="setting-row" htmlFor="pixel-ratio">
                    <span><strong>Чёткость рендера</strong><small>Pixel ratio игрового canvas</small></span>
                    <output htmlFor="pixel-ratio">{settings.video.pixelRatio.toFixed(2)}×</output>
                    <input id="pixel-ratio" type="range" min="0.75" max="2" step="0.25" value={settings.video.pixelRatio} onChange={(event) => updateVideo("pixelRatio", Number(event.target.value))} />
                  </label>
                  <label className="setting-row setting-row--toggle">
                    <span><strong>Сглаживание</strong><small>Применится при следующем создании runtime</small></span>
                    <input type="checkbox" checked={settings.video.antialias} onChange={(event) => updateVideo("antialias", event.target.checked)} />
                  </label>
                  <label className="setting-row" htmlFor="model-quality">
                    <span><strong>Качество моделей</strong><small>Уровень детализации ассетов</small></span>
                    <select id="model-quality" value={settings.video.modelQuality} onChange={(event) => updateVideo("modelQuality", event.target.value as QualityLevel)}>
                      <option value="low">Низкое</option><option value="medium">Среднее</option><option value="high">Высокое</option>
                    </select>
                  </label>
                  <label className="setting-row" htmlFor="texture-quality">
                    <span><strong>Качество текстур</strong><small>Разрешение загружаемых текстур</small></span>
                    <select id="texture-quality" value={settings.video.textureQuality} onChange={(event) => updateVideo("textureQuality", event.target.value as QualityLevel)}>
                      <option value="low">Низкое</option><option value="medium">Среднее</option><option value="high">Высокое</option>
                    </select>
                  </label>
                  <label className="setting-row" htmlFor="fps-limit">
                    <span><strong>Ограничение FPS</strong><small>Симуляция остаётся на фиксированных 64 тиках</small></span>
                    <select id="fps-limit" value={settings.video.fpsLimit} onChange={(event) => updateVideo("fpsLimit", Number(event.target.value))}>
                      <option value="0">Без лимита</option><option value="60">60</option><option value="120">120</option><option value="144">144</option>
                    </select>
                  </label>
                  </>)}

                  {settingsCategory === "audio" && (<>
                  <div className="settings-group-label">
                    <strong>ЗВУК</strong>
                    <small>Громкость игры</small>
                  </div>
                  <label className="setting-row">
                    <span><strong>Громкость игры</strong><small>Общий уровень игровых эффектов</small></span>
                    <output>{settings.audio.gameVolume}%</output>
                    <input type="range" min="0" max="100" step="5" value={settings.audio.gameVolume} onChange={(event) => {
                      const gameVolume = Number(event.target.value);
                      setSettings((current) => ({ ...current, audio: { gameVolume } }));
                      runtimeRef.current?.setGameVolume(gameVolume / 100);
                    }} />
                  </label>
                  </>)}

                  {settingsCategory === "hud" && (<>
                  <div className="settings-group-label">
                    <strong>HUD И ПРИЦЕЛ</strong>
                    <small>Масштаб и читаемость</small>
                  </div>
                  <label className="setting-row">
                    <span><strong>Масштаб HUD</strong><small>Таймер, скорость и подсказки</small></span>
                    <output>{hudScale}%</output>
                    <input type="range" min="85" max="125" step="5" value={hudScale} onChange={(event) => {
                      const scale = Number(event.target.value);
                      setSettings((current) => ({ ...current, hud: { ...current.hud, scale } }));
                    }} />
                  </label>
                  <div className="settings-group-label">
                    <strong>ПРИЦЕЛ</strong>
                    <small>Настройки применяются сразу</small>
                  </div>
                  <div className="crosshair-preview">
                    <Crosshair style={crosshair.style} preview />
                    <span>ПРЕДПРОСМОТР</span>
                  </div>
                  <label className="setting-row" htmlFor="crosshair-style">
                    <span><strong>Форма</strong><small>Точка или классический крест</small></span>
                    <output htmlFor="crosshair-style">{crosshair.style === "dot" ? "ТОЧКА" : "КРЕСТ"}</output>
                    <select
                      id="crosshair-style"
                      value={crosshair.style}
                      onChange={(event) => updateCrosshair("style", event.target.value as CrosshairSettings["style"])}
                    >
                      <option value="dot">Точка</option>
                      <option value="cross">Крест</option>
                    </select>
                  </label>
                  <label className="setting-row" htmlFor="crosshair-color">
                    <span><strong>Цвет</strong><small>Основной цвет прицела</small></span>
                    <output htmlFor="crosshair-color">{crosshair.color.toUpperCase()}</output>
                    <input id="crosshair-color" type="color" value={crosshair.color} onChange={(event) => updateCrosshair("color", event.target.value)} />
                  </label>
                  {crosshair.style === "dot" ? (
                    <label className="setting-row" htmlFor="crosshair-dot-size">
                      <span><strong>Размер точки</strong><small>Диаметр центральной точки</small></span>
                      <output htmlFor="crosshair-dot-size">{crosshair.dotSize} px</output>
                      <input id="crosshair-dot-size" type="range" {...CROSSHAIR_CONFIG.ranges.dotSize} value={crosshair.dotSize} onChange={(event) => updateCrosshair("dotSize", Number(event.target.value))} />
                    </label>
                  ) : (
                    <>
                      <label className="setting-row" htmlFor="crosshair-line-length">
                        <span><strong>Длина линий</strong><small>Размер лучей прицела</small></span>
                        <output htmlFor="crosshair-line-length">{crosshair.lineLength} px</output>
                        <input id="crosshair-line-length" type="range" {...CROSSHAIR_CONFIG.ranges.lineLength} value={crosshair.lineLength} onChange={(event) => updateCrosshair("lineLength", Number(event.target.value))} />
                      </label>
                      <label className="setting-row" htmlFor="crosshair-thickness">
                        <span><strong>Толщина</strong><small>Толщина линий прицела</small></span>
                        <output htmlFor="crosshair-thickness">{crosshair.thickness} px</output>
                        <input id="crosshair-thickness" type="range" {...CROSSHAIR_CONFIG.ranges.thickness} value={crosshair.thickness} onChange={(event) => updateCrosshair("thickness", Number(event.target.value))} />
                      </label>
                      <label className="setting-row" htmlFor="crosshair-gap">
                        <span><strong>Зазор</strong><small>Расстояние от центра</small></span>
                        <output htmlFor="crosshair-gap">{crosshair.gap} px</output>
                        <input id="crosshair-gap" type="range" {...CROSSHAIR_CONFIG.ranges.gap} value={crosshair.gap} onChange={(event) => updateCrosshair("gap", Number(event.target.value))} />
                      </label>
                    </>
                  )}
                  <label className="setting-row" htmlFor="crosshair-opacity">
                    <span><strong>Прозрачность</strong><small>Видимость прицела на карте</small></span>
                    <output htmlFor="crosshair-opacity">{crosshair.opacity}%</output>
                    <input id="crosshair-opacity" type="range" {...CROSSHAIR_CONFIG.ranges.opacity} value={crosshair.opacity} onChange={(event) => updateCrosshair("opacity", Number(event.target.value))} />
                  </label>
                  </>)}

                  {settingsCategory === "viewmodel" && (<>
                  <div className="settings-group-label">
                    <strong>ПОЛОЖЕНИЕ РУК</strong>
                    <small>Поправка относительно базовой позиции</small>
                  </div>
                  <label className="setting-row" htmlFor="viewmodel-offset-x">
                    <span><strong>Ось X</strong><small>Влево / вправо</small></span>
                    <output htmlFor="viewmodel-offset-x">{formatOffset(viewmodelOffset.x)}</output>
                    <input id="viewmodel-offset-x" type="range" min={VIEWMODEL_POSITION_CONFIG.min} max={VIEWMODEL_POSITION_CONFIG.max} step={VIEWMODEL_POSITION_CONFIG.step} value={viewmodelOffset.x} onChange={(event) => updateViewmodelOffset("x", Number(event.target.value))} />
                  </label>
                  <label className="setting-row" htmlFor="viewmodel-offset-y">
                    <span><strong>Ось Y</strong><small>Вниз / вверх</small></span>
                    <output htmlFor="viewmodel-offset-y">{formatOffset(viewmodelOffset.y)}</output>
                    <input id="viewmodel-offset-y" type="range" min={VIEWMODEL_POSITION_CONFIG.min} max={VIEWMODEL_POSITION_CONFIG.max} step={VIEWMODEL_POSITION_CONFIG.step} value={viewmodelOffset.y} onChange={(event) => updateViewmodelOffset("y", Number(event.target.value))} />
                  </label>
                  <label className="setting-row" htmlFor="viewmodel-offset-z">
                    <span><strong>Ось Z</strong><small>Дальше / ближе</small></span>
                    <output htmlFor="viewmodel-offset-z">{formatOffset(viewmodelOffset.z)}</output>
                    <input id="viewmodel-offset-z" type="range" min={VIEWMODEL_POSITION_CONFIG.min} max={VIEWMODEL_POSITION_CONFIG.max} step={VIEWMODEL_POSITION_CONFIG.step} value={viewmodelOffset.z} onChange={(event) => updateViewmodelOffset("z", Number(event.target.value))} />
                  </label>
                  </>)}
                  <button className="secondary-action" type="button" onClick={resetSettings}>СБРОСИТЬ НАСТРОЙКИ</button>
                </div>
              </section>
            )}
          </div>

          <footer className="menu-footer">
            <span>CHROME DESKTOP</span>
            <span>64 HZ FIXED SIM</span>
            <span>PROFILE V0 · CALIBRATION PENDING</span>
          </footer>
        </section>
      )}

      {status === "paused" && (
        <section className="pause-layer" aria-labelledby="pause-title">
          <div className="pause-panel">
            <span className="phase-label">ЗАБЕГ ПРИОСТАНОВЛЕН</span>
            <h1 id="pause-title">Пауза</h1>
            <p>{formatTime(telemetry.elapsedSeconds)} · чекпоинт {telemetry.checkpoint}/{telemetry.checkpointCount}</p>
            <button className="primary-action" type="button" onClick={start}><span>ПРОДОЛЖИТЬ</span><span aria-hidden="true">→</span></button>
            <button className="pause-action" type="button" onClick={restart}>НАЧАТЬ ЗАНОВО</button>
            <button className="pause-action" type="button" onClick={returnToMenu}>В ГЛАВНОЕ МЕНЮ</button>
          </div>
        </section>
      )}

      {status === "finished" && (
        <section className="pause-layer" aria-labelledby="finish-title">
          <div className="pause-panel finish-panel">
            <span className="phase-label">МАРШРУТ ЗАВЕРШЁН</span>
            <h1 id="finish-title">{formatTime(telemetry.elapsedSeconds)}</h1>
            <p>Локальный рекорд: {telemetry.bestSeconds === null ? "—" : formatTime(telemetry.bestSeconds)}</p>
            <button className="primary-action" type="button" onClick={restart}><span>ЕЩЁ РАЗ</span><span aria-hidden="true">→</span></button>
            <button className="pause-action" type="button" onClick={() => runtimeRef.current?.playLastReplay()}>ПОВТОР ПОСЛЕДНЕЙ ПОПЫТКИ</button>
            <button className="pause-action" type="button" onClick={returnToMenu}>В ГЛАВНОЕ МЕНЮ</button>
          </div>
        </section>
      )}
    </main>
  );
}
