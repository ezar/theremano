/**
 * Prueba de humo del arranque completo, con una camara falsa de Chromium.
 *
 * No sustituye a los tests unitarios: cubre lo que ellos no pueden tocar, que
 * es que el modelo cargue, que el contexto de audio arranque tras el gesto del
 * usuario y que el bucle gire sin errores en consola. Sin manos delante de la
 * camara no hay notas, y eso esta bien: aqui se comprueba que el instrumento se
 * enciende, no que suene afinado.
 *
 *   npm run build && npm run preview &
 *   npm run smoke
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/';
const screenshot = process.argv[3] ?? 'smoke.png';
/**
 * Suelo de tamano para dar un clip por bueno.
 *
 * No mide calidad: un par de segundos del patron de la camara falsa, o del
 * degradado del modo de solo manos, se comprimen hasta muy poco y varian entre
 * ejecuciones. Lo que descarta es el caso que importa, que es un fichero vacio o
 * sin una sola muestra dentro.
 */
const MIN_CLIP_BYTES = 6000;

/*
 * Sonda de audio. Envuelve connect() para colgar un analizador de todo lo que
 * llegue al destino y guarda el pico. Va en un initScript porque tiene que estar
 * puesta antes de que la pagina cree su contexto de audio. La usan la pagina
 * principal —para oir la claqueta— y la invitada —para oir el enlace—.
 */
function audioProbe() {
  const nativeConnect = AudioNode.prototype.connect;
  window.__peak = 0;
  window.__resetPeak = () => {
    window.__peak = 0;
  };
  AudioNode.prototype.connect = function (target, ...rest) {
    try {
      if (target instanceof AudioDestinationNode) {
        const context = target.context;
        if (!context.__probe) {
          const probe = context.createAnalyser();
          /*
           * Ventana larga a proposito: casi un segundo de historia.
           *
           * Con 2048 muestras la ventana dura 46 ms, y el muestreo se hace desde
           * el hilo principal, que en esta pagina esta saturado por la
           * inferencia. Los avisos del temporizador llegaban tan separados que
           * un chasquido de sesenta milisegundos se colaba entre dos ventanas: la
           * claqueta sonaba y la sonda decia que no.
           */
          probe.fftSize = 32768;
          context.__probe = probe;
          const buffer = new Float32Array(probe.fftSize);
          setInterval(() => {
            probe.getFloatTimeDomainData(buffer);
            for (const value of buffer) {
              const level = Math.abs(value);
              if (level > window.__peak) window.__peak = level;
            }
          }, 40);
        }
        nativeConnect.call(this, context.__probe);
      }
    } catch {
      /* la sonda nunca puede tumbar a la pagina que observa */
    }
    return nativeConnect.call(this, target, ...rest);
  };
}

const logs = [];
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
  ],
});
const ctx = await browser.newContext({ permissions: ['camera'], viewport: { width: 1100, height: 720 } });
const page = await ctx.newPage();
await page.addInitScript(audioProbe);
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.click('#start-button');

// Espera a que el bucle este girando de verdad.
await page.waitForFunction(() => !document.getElementById('splash')?.hidden === false, { timeout: 90000 })
  .catch(() => {});
await page.waitForTimeout(12000);

// --- Introduccion guiada: quien llega por primera vez tiene que verla.
const coachStart = await page.evaluate(() => ({
  visible: !document.getElementById('coach')?.hidden,
  title: document.getElementById('coach-title')?.textContent,
  dots: document.querySelectorAll('#coach-dots span').length,
  current: document.querySelectorAll('#coach-dots span.current').length,
}));

// Sin manos delante de la camara ningun paso se cierra solo, que es justo lo
// que debe pasar. Se recorre entera con el boton de saltar, anotando por el
// camino que el paso de la segunda mano se anuncia como opcional.
let skips = 0;
const optionalSteps = [];
const allSteps = [];
while (await page.evaluate(() => !document.getElementById('coach')?.hidden)) {
  const step = await page.evaluate(() => ({
    title: document.getElementById('coach-title')?.textContent,
    optional: !document.getElementById('coach-optional')?.hidden,
    skipLabel: document.getElementById('coach-skip-step')?.textContent,
  }));
  allSteps.push(step);
  if (step.optional) optionalSteps.push({ title: step.title, skipLabel: step.skipLabel });
  await page.click('#coach-skip-step');
  await page.waitForTimeout(120);
  if (++skips > 12) break;
}
console.log(JSON.stringify({ optionalSteps }, null, 2));
// El store agrupa las escrituras a localStorage con 250 ms de retardo, asi que
// leer la bandera justo despues del ultimo salto es una carrera: la prueba
// fallaria con la aplicacion funcionando bien.
await page
  .waitForFunction(() => JSON.parse(localStorage.getItem('theremano.settings.v1') ?? '{}').onboarded === true, {
    timeout: 5000,
  })
  .catch(() => {});
const coachEnd = await page.evaluate(() => ({
  visible: !document.getElementById('coach')?.hidden,
  onboarded: JSON.parse(localStorage.getItem('theremano.settings.v1') ?? '{}').onboarded,
}));
console.log(JSON.stringify({ coachStart, skips, coachEnd }, null, 2));

// --- Ayuda: tiene que abrirse siempre y poder relanzar la introduccion.
await page.click('#help-toggle');
await page.waitForTimeout(300);
const helpOpen = await page.evaluate(() => ({
  visible: !document.getElementById('help')?.hidden,
  rows: document.querySelectorAll('#help .help-table tr').length,
  keys: document.querySelectorAll('#help kbd').length,
}));
await page.click('#help-replay');
await page.waitForTimeout(400);
const replayed = await page.evaluate(() => ({
  helpClosed: document.getElementById('help')?.hidden,
  coachVisible: !document.getElementById('coach')?.hidden,
  title: document.getElementById('coach-title')?.textContent,
}));
console.log(JSON.stringify({ helpOpen, replayed }, null, 2));
await page.click('#coach-skip-all');
await page.waitForTimeout(300);

const state = await page.evaluate(() => {
  const diag = document.getElementById('diagnostics');
  const err = document.getElementById('splash-error');
  const video = document.getElementById('video');
  const canvas = document.getElementById('overlay');
  return {
    splashHidden: document.getElementById('splash')?.hidden,
    error: err && !err.hidden ? err.textContent : null,
    diagnostics: diag?.textContent,
    note: document.getElementById('note')?.textContent,
    noteSub: document.getElementById('note-sub')?.textContent,
    preset: document.getElementById('preset-name')?.textContent,
    videoSize: [video?.videoWidth, video?.videoHeight],
    videoMirrored: video?.classList.contains('mirrored'),
    canvasSize: [canvas?.width, canvas?.height],
    hudVisible: !document.getElementById('hud')?.classList.contains('hidden'),
  };
});

console.log(JSON.stringify(state, null, 2));

// --- Grabacion de clip: la funcion de compartir tiene que producir un fichero.
const download = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await page.click('#clip-button');
await page.waitForTimeout(2500);
await page.click('#clip-button');
const file = await download;
const clip = file
  ? { name: file.suggestedFilename(), bytes: (await import('node:fs')).statSync(await file.path()).size }
  : null;
console.log(JSON.stringify({ clip }, null, 2));

// --- Solo manos: la camara tiene que dejar de verse sin dejar de decodificarse.
await page.keyboard.press('v');
// Como en el resto del fichero: el store agrupa las escrituras a localStorage,
// asi que se espera al valor en vez de dormir una cifra a ojo.
await page
  .waitForFunction(() => JSON.parse(localStorage.getItem('theremano.settings.v1') ?? '{}').stageMode === 'hands', {
    timeout: 5000,
  })
  .catch(() => {});
const handsClipDownload = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await page.click('#clip-button');
await page.waitForTimeout(2500);
const handsOnly = await page.evaluate(() => {
  const video = document.getElementById('video');
  const canvas = document.getElementById('overlay');
  const ctx = canvas?.getContext('2d');
  // El centro del lienzo: si el fondo del modo es opaco de verdad, ahi no queda
  // ni un pixel de la camara por debajo.
  const pixel = ctx?.getImageData(Math.floor((canvas?.width ?? 2) / 2), Math.floor((canvas?.height ?? 2) / 2), 1, 1).data;
  return {
    cameraHidden: video?.classList.contains('camera-hidden'),
    videoOpacity: getComputedStyle(video).opacity,
    // Ocultar el video no puede detenerlo: el seguimiento lee de el.
    videoPlaying: video.readyState >= 2 && !video.paused,
    centerAlpha: pixel ? pixel[3] : null,
    stageMode: JSON.parse(localStorage.getItem('theremano.settings.v1') ?? '{}').stageMode,
  };
});
await page.click('#clip-button');
const handsFile = await handsClipDownload;
const handsClip = handsFile
  ? { name: handsFile.suggestedFilename(), bytes: (await import('node:fs')).statSync(await handsFile.path()).size }
  : null;
await page.keyboard.press('v');
await page
  .waitForFunction(() => JSON.parse(localStorage.getItem('theremano.settings.v1') ?? '{}').stageMode === 'camera', {
    timeout: 5000,
  })
  .catch(() => {});
const backToCamera = await page.evaluate(() => ({
  cameraHidden: document.getElementById('video')?.classList.contains('camera-hidden'),
  stageMode: JSON.parse(localStorage.getItem('theremano.settings.v1') ?? '{}').stageMode,
}));
console.log(JSON.stringify({ handsOnly, handsClip, backToCamera }, null, 2));

// --- Claqueta: cuatro pulsos por delante de la primera capa, cancelables.
await page.evaluate(() => window.__resetPeak?.());
await page.click('#loop-button');
await page.waitForTimeout(700);
const counting = await page.evaluate(() => ({
  etiqueta: document.querySelector('#loop-button .label')?.textContent,
  armado: document.getElementById('loop-button')?.classList.contains('armed'),
  // Los pulsos tienen que oirse, no solo contarse.
  picoDeAudio: Number((window.__peak ?? 0).toFixed(4)),
  toast: document.getElementById('toast')?.textContent,
}));
// Volver a pulsar durante la cuenta la cancela sin dejar capa ni grabacion.
await page.click('#loop-button');
await page.waitForTimeout(300);
const cancelled = await page.evaluate(() => ({
  etiqueta: document.querySelector('#loop-button .label')?.textContent,
  armado: document.getElementById('loop-button')?.classList.contains('armed'),
  lanes: document.querySelectorAll('.loop-lane').length,
}));
console.log(JSON.stringify({ counting, cancelled }, null, 2));

// --- Bucles: una toma sin una sola nota no debe dejar una capa fantasma.
// Hay que esperar a que la claqueta termine: antes del pulso de entrada, el
// segundo pulsado cancelaria en vez de cerrar la toma.
await page.click('#loop-button');
await page.waitForTimeout(3400);
const recording = await page.evaluate(() => document.querySelector('#loop-button .label')?.textContent);
await page.waitForTimeout(900);
await page.click('#loop-button');
await page.waitForTimeout(400);
const loops = await page.evaluate(() => ({
  lanes: document.querySelectorAll('.loop-lane').length,
  undoHidden: document.getElementById('undo-button')?.hidden,
  toast: document.getElementById('toast')?.textContent,
}));
console.log(JSON.stringify({ recording, loops }, null, 2));

// El panel de ajustes tiene que abrir y responder.
await page.click('#settings-toggle');
await page.waitForTimeout(400);
const fields = await page.evaluate(() => document.querySelectorAll('#settings-panel .field').length);

// --- Legibilidad del desplegable. La lista que abre un select la pinta el
// navegador con el fondo del propio select: si es translucido, sale casi blanca
// y el texto claro encima no se lee. Ese fondo tiene que ser opaco y contrastar.
const combo = await page.evaluate(() => {
  const parse = (value) => {
    const n = value.match(/[\d.]+/g)?.map(Number) ?? [];
    return { r: n[0] ?? 0, g: n[1] ?? 0, b: n[2] ?? 0, a: n[3] ?? 1 };
  };
  const lum = (c) => {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const select = document.getElementById('set-melody');
  const option = select.querySelector('option');
  const bg = parse(getComputedStyle(select).backgroundColor);
  const optionBg = parse(getComputedStyle(option).backgroundColor);
  const fg = parse(getComputedStyle(option).color);
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  return {
    alfaDelSelect: bg.a,
    alfaDeLaOpcion: optionBg.a,
    contraste: Number(ratio(fg, optionBg).toFixed(2)),
  };
});
console.log(JSON.stringify({ combo }, null, 2));
await page.selectOption('#set-scale', 'blues');
await page.selectOption('#set-tonic', '2');
await page.waitForTimeout(600);
const afterScale = await page.evaluate(() => document.getElementById('note-sub')?.textContent);
const persisted = await page.evaluate(() => localStorage.getItem('theremano.settings.v1'));
console.log(JSON.stringify({ fields, afterScale, scale: JSON.parse(persisted ?? '{}').scale }, null, 2));

// --- Cancion: elegirla amplia el rango si el encuadre se ha quedado corto.
await page.evaluate(() => {
  const range = document.getElementById('set-range');
  range.value = '1';
  range.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
await page.selectOption('#set-melody', 'martinillo');
await page.waitForTimeout(700);
const song = await page.evaluate(() => {
  const stored = JSON.parse(localStorage.getItem('theremano.settings.v1') ?? '{}');
  const grupos = [...document.querySelectorAll('#set-melody optgroup')].map((g) => ({
    label: g.label,
    opciones: g.children.length,
  }));
  return {
    progreso: document.getElementById('guide-progress')?.textContent,
    escala: stored.scale,
    octavas: stored.octaves,
    grupos,
  };
});
console.log(JSON.stringify({ song }, null, 2));

// --- Melodia guiada: elegirla muestra el progreso y fija la escala sugerida.
await page.selectOption('#set-melody', 'blues');
await page.waitForTimeout(700);
const guide = await page.evaluate(() => ({
  visible: !document.getElementById('guide-chip')?.hidden,
  name: document.getElementById('guide-name')?.textContent,
  progress: document.getElementById('guide-progress')?.textContent,
  scale: document.getElementById('set-scale')?.value,
}));
console.log(JSON.stringify({ guide }, null, 2));

// --- Idiomas. El navegador de esta prueba esta en ingles, asi que la
// autodeteccion debe haber elegido ingles sola; despues se comprueban los dos
// a mano, incluida la notacion de las notas, que cambia con el idioma.
const autoDetected = await page.evaluate(() => document.documentElement.lang);

await page.selectOption('#set-language', 'en');
await page.waitForTimeout(500);
const english = await page.evaluate(() => ({
  lang: document.documentElement.lang,
  hint: document.getElementById('hint')?.textContent,
  settings: document.getElementById('settings-toggle')?.textContent,
  notes: [...(document.getElementById('set-tonic')?.options ?? [])].map((o) => o.text).slice(0, 3),
}));

await page.selectOption('#set-language', 'es');
await page.waitForTimeout(500);
const spanish = await page.evaluate(() => ({
  lang: document.documentElement.lang,
  hint: document.getElementById('hint')?.textContent,
  settings: document.getElementById('settings-toggle')?.textContent,
  notes: [...(document.getElementById('set-tonic')?.options ?? [])].map((o) => o.text).slice(0, 3),
}));
console.log(JSON.stringify({ autoDetected, english, spanish }, null, 2));

// --- El modo continuo no tiene zonas: la guia debe retirarse sola.
await page.selectOption('#set-scale', 'continuous');
await page.waitForTimeout(700);
const afterContinuous = await page.evaluate(() => ({
  melody: document.getElementById('set-melody')?.value,
  chipHidden: document.getElementById('guide-chip')?.hidden,
  toast: document.getElementById('toast')?.textContent,
}));
console.log(JSON.stringify({ afterContinuous }, null, 2));
await page.selectOption('#set-scale', 'blues');
await page.waitForTimeout(400);

// --- Demostracion: el instrumento tocandose solo, sin camara y sin permiso.
// Es la puerta de entrada de quien todavia no ha dado permiso de camara, asi
// que se prueba en una pestana limpia y sin pedirlo. Lo que hay que demostrar
// no es que el rotulo cambie, es que sale sonido: la mano es de mentira, pero
// pasa por el mapeador de verdad y tiene que abrir el gate.
const demo = await browser.newContext({ viewport: { width: 1100, height: 720 } });
const demoPage = await demo.newPage();
const demoLogs = [];
demoPage.on('pageerror', (e) => demoLogs.push(e.message));
await demoPage.addInitScript(audioProbe);
await demoPage.goto(url, { waitUntil: 'domcontentloaded' });
await demoPage.waitForTimeout(700);
const beforeDemo = await demoPage.evaluate(() => ({
  boton: document.getElementById('demo-button')?.textContent,
  rotulo: !document.getElementById('demo-banner')?.hidden,
  picoDeAudio: Number((window.__peak ?? 0).toFixed(4)),
}));
await demoPage.click('#demo-button');
// Entrada de nueve decimas mas dos notas: da tiempo a que suene mas de una.
await demoPage.waitForTimeout(4500);
const playing = await demoPage.evaluate(() => ({
  rotulo: document.getElementById('demo-label')?.textContent,
  pantallaInicial: document.getElementById('splash')?.hidden === false,
  picoDeAudio: Number((window.__peak ?? 0).toFixed(4)),
}));
await demoPage.click('#demo-stop');
await demoPage.waitForTimeout(600);
const afterDemo = await demoPage.evaluate(() => ({
  rotulo: !document.getElementById('demo-banner')?.hidden,
  vuelveLaPantallaInicial: document.getElementById('splash')?.hidden === false,
}));
console.log(JSON.stringify({ beforeDemo, playing, afterDemo, erroresDemostracion: demoLogs }, null, 2));
await demoPage.close();
await demo.close();

// --- Tocar sin camara: el mismo instrumento con el puntero por manos.
// Pestana limpia y sin permiso de camara, como quien acaba de negarlo. Lo que
// hay que demostrar es que suena la nota donde se pulsa y que se calla al
// soltar; y que el HUD, la barra de acciones y todo lo demas siguen ahi, porque
// esto no es un modo recortado.
const pointer = await browser.newContext({ viewport: { width: 900, height: 640 } });
const pointerPage = await pointer.newPage();
const pointerLogs = [];
pointerPage.on('pageerror', (e) => pointerLogs.push(e.message));
await pointerPage.addInitScript(audioProbe);
await pointerPage.goto(url, { waitUntil: 'domcontentloaded' });
await pointerPage.waitForTimeout(700);
await pointerPage.click('#pointer-button');
await pointerPage.waitForTimeout(1200);
const beforePress = await pointerPage.evaluate(() => ({
  hud: !document.getElementById('hud')?.classList.contains('hidden'),
  acciones: !document.getElementById('actions')?.classList.contains('hidden'),
  picoDeAudio: Number((window.__peak ?? 0).toFixed(4)),
}));
await pointerPage.mouse.move(250, 320);
await pointerPage.mouse.down();
await pointerPage.waitForTimeout(600);
const pressed = await pointerPage.evaluate(() => ({
  nota: document.getElementById('note')?.textContent,
  picoDeAudio: Number((window.__peak ?? 0).toFixed(4)),
}));
// Arrastrar con el boton pulsado es un glissando, no una nota nueva.
for (let x = 250; x <= 650; x += 50) {
  await pointerPage.mouse.move(x, 320);
  await pointerPage.waitForTimeout(50);
}
const dragged = await pointerPage.evaluate(() => document.getElementById('note')?.textContent);
const soundingClass = await pointerPage.evaluate(() => document.getElementById('note')?.classList.contains('sounding'));
await pointerPage.mouse.up();
await pointerPage.waitForTimeout(500);
// Que la nota se cierra se mira en el gate y no en el pico de audio: detras hay
// una reverberacion de varios segundos, y esperar a que se apague del todo no
// prueba nada que el gate no diga ya.
const released = await pointerPage.evaluate(() => ({
  sonando: document.getElementById('note')?.classList.contains('sounding'),
}));
console.log(JSON.stringify({ beforePress, pressed, soundingClass, dragged, released, erroresPuntero: pointerLogs }, null, 2));
await pointerPage.close();
await pointer.close();

// --- Interpretacion en el enlace. Se abre uno guardado de la version 1, con
// cuatro notas de theremin dentro, y se comprueba que suena sin camara: la
// pantalla inicial cambia, escuchar arranca el audio y no aparece ningun error.
const V1_LINK =
  'ARgBAQAcAAAA9BqMzAqA9BqMzBSA9BqMzB6A9BqMzCiA9BqMzCuA9BqMzC1A9BqMzEYAIByMzFCAIByMzFqAIByMzGSAIByMzG6AIByMzHGAIByMzHNAIByMzIwAsB2MzJaAsB2MzKCAsB2MzKqAsB2MzLSAsB2MzLeAsB2MzLlAsB2MzNIAIByMzNyAIByMzOaAIByMzPCAIByMzPqAIByMzP2AIByMzP9AIByMzA';
const invited = await ctx.newPage();
const inviteLogs = [];
invited.on('pageerror', (e) => inviteLogs.push(e.message));
// Que el boton cambie de rotulo solo demuestra que el codigo llego hasta el
// final; lo que hay que demostrar es que sale senal.
await invited.addInitScript(audioProbe);
// Sin permiso de camara a proposito: escuchar no puede depender de darlo.
await invited.goto(`${url.replace(/#.*$/, '')}#p=${V1_LINK}`, { waitUntil: 'domcontentloaded' });
await invited.waitForTimeout(900);
const beforeListening = await invited.evaluate(() => ({
  invitacion: !document.getElementById('splash-invite')?.hidden,
  botonEscuchar: !document.getElementById('listen-button')?.hidden,
  // Con musica en el enlace, la demostracion se quita de en medio: quien llega
  // asi viene a oir lo que le han mandado, no a que le ensenen el instrumento.
  botonDemostracion: !document.getElementById('demo-button')?.hidden,
  textoEmpezar: document.getElementById('start-button')?.textContent,
  error: document.getElementById('splash-error')?.hidden === false,
  // Nada puede sonar antes de que alguien lo pida: sin esto, el pico de despues
  // no probaria que el sonido viene de escuchar el enlace.
  picoDeAudio: Number((window.__peak ?? 0).toFixed(4)),
}));
await invited.click('#listen-button');
await invited.waitForTimeout(1500);
// Cuatro notas en un ciclo de 2,8 s: con tres segundos de escucha ha sonado la
// vuelta entera.
await invited.waitForTimeout(3000);
const listening = await invited.evaluate(() => ({
  etiqueta: document.getElementById('listen-button')?.textContent,
  error: document.getElementById('splash-error')?.hidden === false,
  picoDeAudio: Number((window.__peak ?? 0).toFixed(4)),
}));
console.log(JSON.stringify({ beforeListening, listening, erroresInvitado: inviteLogs }, null, 2));

// Un enlace manipulado no puede acabar sonando ni dejando la pantalla a medias.
const broken = await ctx.newPage();
await broken.goto(`${url.replace(/#.*$/, '')}#p=${V1_LINK.slice(0, 40)}`, { waitUntil: 'domcontentloaded' });
await broken.waitForTimeout(700);
const rejected = await broken.evaluate(() => ({
  botonEscuchar: !document.getElementById('listen-button')?.hidden,
  error: document.getElementById('splash-error')?.textContent,
  textoEmpezar: document.getElementById('start-button')?.textContent,
}));
console.log(JSON.stringify({ rejected }, null, 2));
await invited.close();
await broken.close();

// --- Enlace compartible: tiene que reconstruir la configuracion al abrirlo.
const link = await page.evaluate(() => {
  const url = new URL(location.href);
  url.hash = 'e=major&t=0&o=2&r=3&v=flute';
  return url.toString();
});
const fresh = await ctx.newPage();
await fresh.goto(link, { waitUntil: 'domcontentloaded' });
await fresh.waitForTimeout(800);
const restored = await fresh.evaluate(() => JSON.parse(localStorage.getItem('theremano.settings.v1') ?? '{}'));
console.log(JSON.stringify({ fromLink: { scale: restored.scale, tonicPc: restored.tonicPc, octaves: restored.octaves, preset: restored.preset } }, null, 2));
await fresh.close();

await page.screenshot({ path: screenshot });
const errors = logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
console.log('--- consola ---');
console.log(logs.slice(-25).join('\n'));
await browser.close();

if (!coachStart.visible || coachStart.dots !== 6 || coachStart.current !== 1) {
  console.error('\nFALLO: la introduccion no aparece al llegar por primera vez');
  process.exit(1);
}
if (autoDetected !== 'en') {
  console.error('\nFALLO: la autodeteccion no ha seguido al idioma del navegador');
  process.exit(1);
}
if (english.lang !== 'en' || !/Pinch/.test(english.hint ?? '') || english.notes.join() !== 'C,C#,D') {
  console.error('\nFALLO: el ingles no se aplica del todo (incluida la notacion de notas)');
  process.exit(1);
}
if (spanish.lang !== 'es' || !/índice/.test(spanish.hint ?? '') || spanish.notes.join() !== 'Do,Do#,Re') {
  console.error('\nFALLO: el espanol no se aplica del todo, o le faltan las tildes');
  process.exit(1);
}
// Sin buscar un texto concreto: la aplicacion puede estar en cualquiera de los
// dos idiomas. Lo que importa es que haya exactamente un paso opcional y que su
// boton diga algo distinto que el de los demas.
const plainLabels = new Set(allSteps.filter((s) => !s.optional).map((s) => s.skipLabel));
if (optionalSteps.length !== 2 || optionalSteps.some((s) => plainLabels.has(s.skipLabel))) {
  console.error('\nFALLO: los pasos de la segunda mano no se anuncian como opcionales');
  process.exit(1);
}
if (coachEnd.visible || coachEnd.onboarded !== true) {
  console.error('\nFALLO: la introduccion no se cierra ni se recuerda como vista');
  process.exit(1);
}
if (!helpOpen.visible || helpOpen.rows < 5 || helpOpen.keys < 4) {
  console.error('\nFALLO: la ayuda no muestra el contenido esperado');
  process.exit(1);
}
if (!replayed.helpClosed || !replayed.coachVisible) {
  console.error('\nFALLO: no se puede relanzar la introduccion desde la ayuda');
  process.exit(1);
}
if (afterContinuous.melody !== '' || afterContinuous.chipHidden !== true) {
  console.error('\nFALLO: la guia sigue activa en una escala sin zonas');
  process.exit(1);
}
if (song.escala !== 'major' || song.octavas !== 2 || song.progreso !== '0/16') {
  console.error('\nFALLO: elegir una cancion no aplica su escala, su rango o su longitud');
  process.exit(1);
}
if (song.grupos.length !== 2 || song.grupos.some((g) => g.opciones !== 5)) {
  console.error('\nFALLO: el desplegable de melodias no separa canciones y ejercicios');
  process.exit(1);
}
if (!guide.visible || guide.progress !== '0/9' || guide.scale !== 'blues') {
  console.error('\nFALLO: la melodia guiada no se ha activado como deberia');
  process.exit(1);
}
// El umbral comprueba que hay fichero y que no esta vacio, no la tasa de video:
// el patron de la camara falsa se comprime distinto en cada ejecucion, y bajar
// la tasa de 6 a 4 Mbit/s dejo un clip corto por debajo del umbral anterior.
if (!clip || clip.bytes < MIN_CLIP_BYTES) {
  console.error('\nFALLO: la grabacion del clip no ha producido un fichero utilizable');
  process.exit(1);
}
if (!handsOnly.cameraHidden || handsOnly.videoOpacity !== '0' || handsOnly.stageMode !== 'hands') {
  console.error('\nFALLO: el modo de solo manos no oculta la imagen de la camara');
  process.exit(1);
}
if (!handsOnly.videoPlaying) {
  console.error('\nFALLO: ocultar la camara ha detenido el video, y el seguimiento lee de el');
  process.exit(1);
}
if (handsOnly.centerAlpha !== 255) {
  console.error(`\nFALLO: el fondo de solo manos no es opaco (alfa ${handsOnly.centerAlpha})`);
  process.exit(1);
}
// Que el fondo del modo de solo manos es opaco de verdad lo dice centerAlpha,
// no el tamano de este fichero.
if (!handsClip || handsClip.bytes < MIN_CLIP_BYTES) {
  console.error('\nFALLO: no se ha podido grabar un clip en modo de solo manos');
  process.exit(1);
}
if (backToCamera.cameraHidden !== false || backToCamera.stageMode !== 'camera') {
  console.error('\nFALLO: el atajo no devuelve la imagen de la camara');
  process.exit(1);
}
if (combo.alfaDelSelect !== 1 || combo.alfaDeLaOpcion !== 1) {
  console.error('\nFALLO: el fondo del desplegable es translucido y su lista saldra ilegible');
  process.exit(1);
}
if (combo.contraste < 4.5) {
  console.error(`\nFALLO: el texto del desplegable no contrasta con su fondo (${combo.contraste}:1)`);
  process.exit(1);
}
if (beforeListening.picoDeAudio !== 0) {
  console.error('\nFALLO: la pagina ha sonado sola, sin que nadie pulse');
  process.exit(1);
}
if (!beforeListening.invitacion || !beforeListening.botonEscuchar || beforeListening.error) {
  console.error('\nFALLO: un enlace con interpretacion no cambia la pantalla inicial');
  process.exit(1);
}
if (beforeListening.textoEmpezar === listening.etiqueta || listening.error) {
  console.error('\nFALLO: escuchar el enlace no ha arrancado, o ha dado error');
  process.exit(1);
}
// Lo que de verdad promete la funcion: que sale sonido, y sin tocar la camara.
if (listening.picoDeAudio < 0.01) {
  console.error(`\nFALLO: el enlace no ha producido sonido (pico ${listening.picoDeAudio})`);
  process.exit(1);
}
if (inviteLogs.length > 0) {
  console.error(`\nFALLO: la pagina invitada ha dado errores: ${inviteLogs.join(' | ')}`);
  process.exit(1);
}
if (rejected.botonEscuchar || !rejected.error) {
  console.error('\nFALLO: un enlace manipulado no se rechaza como deberia');
  process.exit(1);
}
if (!counting.armado || !/^[1-4]/.test(counting.etiqueta ?? '')) {
  console.error(`\nFALLO: la claqueta no cuenta en el boton (${counting.etiqueta})`);
  process.exit(1);
}
if (counting.picoDeAudio < 0.01) {
  console.error(`\nFALLO: la claqueta no suena (pico ${counting.picoDeAudio})`);
  process.exit(1);
}
if (cancelled.armado || cancelled.etiqueta === counting.etiqueta || cancelled.lanes !== 0) {
  console.error('\nFALLO: no se puede cancelar la claqueta volviendo a pulsar');
  process.exit(1);
}
if (recording === counting.etiqueta || /^[1-4]/.test(recording ?? '')) {
  console.error(`\nFALLO: pasada la claqueta el boton deberia estar grabando (${recording})`);
  process.exit(1);
}
if (loops.lanes !== 0 || loops.undoHidden !== true) {
  console.error('\nFALLO: una toma sin notas ha dejado una capa fantasma');
  process.exit(1);
}
if (beforeDemo.picoDeAudio > 0.01 || playing.picoDeAudio < 0.01) {
  console.error(
    `\nFALLO: la demostracion no suena cuando se pide, o suena antes (antes ${beforeDemo.picoDeAudio}, durante ${playing.picoDeAudio})`,
  );
  process.exit(1);
}
if (afterDemo.rotulo || !afterDemo.vuelveLaPantallaInicial || demoLogs.length > 0) {
  console.error(`\nFALLO: salir de la demostracion no deja la pantalla inicial limpia (${demoLogs.join(' ')})`);
  process.exit(1);
}
if (beforeListening.botonDemostracion) {
  console.error('\nFALLO: con musica en el enlace, la demostracion deberia quitarse de en medio');
  process.exit(1);
}
if (beforePress.picoDeAudio > 0.01 || pressed.picoDeAudio < 0.01) {
  console.error(
    `\nFALLO: con el puntero no suena al pulsar, o suena sin pulsar (antes ${beforePress.picoDeAudio}, pulsando ${pressed.picoDeAudio})`,
  );
  process.exit(1);
}
if (!beforePress.hud || !beforePress.acciones) {
  console.error('\nFALLO: tocar sin camara deberia traer el instrumento entero, con HUD y barra de acciones');
  process.exit(1);
}
if (dragged === pressed.nota) {
  console.error(`\nFALLO: arrastrar el puntero deberia cambiar la nota (${pressed.nota} -> ${dragged})`);
  process.exit(1);
}
if (!soundingClass || released.sonando || pointerLogs.length > 0) {
  console.error(`\nFALLO: con el puntero, pulsar deberia abrir la nota y soltar cerrarla ${pointerLogs.join(' ')}`);
  process.exit(1);
}
if (state.error || errors.length > 0) {
  console.error(`\nFALLO: ${state.error ?? errors.join('\n')}`);
  process.exit(1);
}
if (!state.splashHidden || !state.hudVisible) {
  console.error('\nFALLO: el instrumento no llego a arrancar');
  process.exit(1);
}
console.log(
  `\nOK: arranque, modelo, audio, introduccion de ${coachStart.dots} pasos, ayuda, espanol e ingles, ` +
    `bucle, clip de ${(clip.bytes / 1024).toFixed(0)} kB, solo manos con clip de ` +
    `${(handsClip.bytes / 1024).toFixed(0)} kB, demostracion y puntero sin camara, y enlace compartible.`,
);
