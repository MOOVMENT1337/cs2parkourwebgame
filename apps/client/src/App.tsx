import { useEffect, useRef, useState, type CSSProperties } from "react";
import type {
  GameRuntime,
  GloveId,
  KnifeId,
  KnifeFinish,
  RuntimeStatus,
  RuntimeTelemetry,
} from "./game/GameRuntime";
import {
  DEFAULT_GLOVE_ID,
  DEFAULT_KNIFE_ID,
  GLOVE_CATALOG,
  KNIFE_CATALOG,
  getKnifeName,
} from "./game/viewmodelCatalog";

type MenuSection = "home" | "maps" | "loadout" | "cases" | "settings";
type LoadoutCategory = "knives" | "gloves" | "finishes";

const INITIAL_TELEMETRY: RuntimeTelemetry = {
  status: "loading",
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

const KNIFE_FINISHES: ReadonlyArray<{
  id: KnifeFinish;
  name: string;
  subtitle: string;
  color: string;
}> = [
  { id: "emerald", name: "Flow Emerald", subtitle: "Заводская серия", color: "#34d399" },
  { id: "amber", name: "Solar Amber", subtitle: "Тестовая серия", color: "#f59e0b" },
  { id: "violet", name: "Violet Shift", subtitle: "Тестовая серия", color: "#a78bfa" },
];

const formatTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainingSeconds
    .toFixed(3)
    .padStart(6, "0")}`;
};

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const [status, setStatus] = useState<RuntimeStatus>("loading");
  const [telemetry, setTelemetry] = useState<RuntimeTelemetry>(INITIAL_TELEMETRY);
  const [menuSection, setMenuSection] = useState<MenuSection>("home");
  const [debugVisible, setDebugVisible] = useState(false);
  const [knifeFinish, setKnifeFinish] = useState<KnifeFinish>("emerald");
  const [knifeId, setKnifeId] = useState<KnifeId>(DEFAULT_KNIFE_ID);
  const [gloveId, setGloveId] = useState<GloveId>(DEFAULT_GLOVE_ID);
  const [loadoutCategory, setLoadoutCategory] =
    useState<LoadoutCategory>("knives");
  const [fov, setFov] = useState(82);
  const [sensitivity, setSensitivity] = useState(2.1);
  const [hudScale, setHudScale] = useState(100);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let runtime: GameRuntime | null = null;
    let cancelled = false;

    void import("./game/GameRuntime")
      .then(async ({ GameRuntime: RuntimeConstructor }) => {
        if (cancelled) return;

        runtime = new RuntimeConstructor(canvas, {
          onTelemetry: setTelemetry,
          onStatus: setStatus,
        });
        runtimeRef.current = runtime;
        await runtime.initialize();
      })
      .catch((initializationError: unknown) => {
        if (cancelled) return;

        setError(
          initializationError instanceof Error
            ? initializationError.message
            : "Не удалось инициализировать игровой runtime",
        );
      });

    return () => {
      cancelled = true;
      runtime?.dispose();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, []);

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

  const start = () => runtimeRef.current?.start();
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
    setKnifeId(knife);
    runtimeRef.current?.setKnifeModel(knife);
  };
  const selectGloves = (gloves: GloveId) => {
    setGloveId(gloves);
    runtimeRef.current?.setGloveModel(gloves);
  };
  const updateFov = (value: number) => {
    setFov(value);
    runtimeRef.current?.setFov(value);
  };
  const updateSensitivity = (value: number) => {
    setSensitivity(value);
    runtimeRef.current?.setMouseSensitivity(value / 1000);
  };
  const resetSettings = () => {
    setFov(82);
    setSensitivity(2.1);
    setHudScale(100);
    runtimeRef.current?.setFov(82);
    runtimeRef.current?.setMouseSensitivity(0.0021);
  };

  const shellStyle = {
    "--hud-scale": hudScale / 100,
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

          <div className="crosshair" aria-hidden="true"><span /><span /></div>

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
            <small><kbd>F</kbd> ОСМОТРЕТЬ</small>
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
        </section>
      )}

      {status === "ready" && !error && (
        <section className="menu-layer">
          <header className="menu-topbar">
            <div className="menu-brand">
              <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
              <span>PARKOUR FLOW</span>
              <small>PRE-ALPHA 0.3</small>
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

          <div className="menu-content">
            {menuSection === "home" && (
              <section className="home-panel">
                <div className="home-copy">
                  <span className="phase-label">SINGLE PLAYER · MOVEMENT LAB</span>
                  <h1>Поймай ритм.<br /><em>Сохрани скорость.</em></h1>
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
                  <h1>Выбери маршрут</h1>
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
                  <h1>Инвентарь</h1>
                  <p>{KNIFE_CATALOG.length} модели ножей и {GLOVE_CATALOG.length} комплектов рук. Выбранный предмет лениво загружается и сразу применяется к viewmodel.</p>
                </div>

                <div className="loadout-tabs" role="tablist" aria-label="Категория снаряжения">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={loadoutCategory === "knives"}
                    className={loadoutCategory === "knives" ? "is-active" : ""}
                    onClick={() => setLoadoutCategory("knives")}
                  >НОЖИ <span>{KNIFE_CATALOG.length}</span></button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={loadoutCategory === "gloves"}
                    className={loadoutCategory === "gloves" ? "is-active" : ""}
                    onClick={() => setLoadoutCategory("gloves")}
                  >ПЕРЧАТКИ <span>{GLOVE_CATALOG.length}</span></button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={loadoutCategory === "finishes"}
                    className={loadoutCategory === "finishes" ? "is-active" : ""}
                    onClick={() => setLoadoutCategory("finishes")}
                  >ОТДЕЛКИ <span>{KNIFE_FINISHES.length}</span></button>
                </div>

                {loadoutCategory === "knives" && (
                  <div className="inventory-grid" role="group" aria-label="Модели ножей">
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

                {loadoutCategory === "gloves" && (
                  <div className="inventory-grid inventory-grid--gloves" role="group" aria-label="Модели перчаток">
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
                  <div className="finish-list finish-list--inventory" role="group" aria-label="Отделка ножа">
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
                  <h1>Кейсы и награды</h1>
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
                  <h1>Управление и HUD</h1>
                  <p>Изменения применяются сразу и остаются активны до перезагрузки страницы.</p>
                </div>
                <div className="settings-list">
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
                  <label className="setting-row">
                    <span><strong>Масштаб HUD</strong><small>Таймер, скорость и подсказки</small></span>
                    <output>{hudScale}%</output>
                    <input type="range" min="85" max="125" step="5" value={hudScale} onChange={(event) => setHudScale(Number(event.target.value))} />
                  </label>
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
            <button className="pause-action" type="button" onClick={returnToMenu}>В ГЛАВНОЕ МЕНЮ</button>
          </div>
        </section>
      )}
    </main>
  );
}
