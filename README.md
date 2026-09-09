# theremano

Instrumento musical controlado con las manos a través de la cámara del navegador.
Sin contacto, sin instalación, sin servidor.

La mano derecha toca la melodía. La izquierda controla la expresión. El navegador
captura vídeo, extrae 21 puntos por mano con MediaPipe, suaviza la señal y la
traduce a parámetros de un sintetizador.

La premisa de diseño es que **debe sonar bien aunque no sepas tocar**. Por eso la
cuantización a escala es el modo por defecto y el glissando continuo es opcional,
no al revés.

---

## Cómo se toca

| Gesto | Efecto |
| --- | --- |
| Mano de melodía, posición horizontal | Altura de la nota, dos octavas de izquierda a derecha |
| Pulgar contra índice | Llave: junta para que suene, separa para callar |
| Mano de melodía, altura | Corte del filtro paso bajo: arriba brillante, abajo oscuro |
| Mano de expresión, altura | Volumen maestro |
| Mano de expresión, dedos extendidos (1 a 4) | Timbre |

Con una sola mano a la vista, esa mano es la de melodía. Perder una mano no
silencia nada: su último estado se conserva 500 ms antes de darla por ausente.

---

## Arrancar en local

```bash
npm install     # descarga el modelo y copia el WASM a public/
npm run dev     # http://localhost:5173
```

La cámara solo funciona en contexto seguro: `localhost` o `https`. Para probar
desde el móvil en la red local hace falta servir por HTTPS o usar un túnel.

```bash
npm test        # 39 pruebas: filtro, gate, roles, escalas, instrumento completo
npm run typecheck
npm run build
npm run preview
npm run smoke   # arranque real en Chromium con cámara falsa (requiere playwright)
```

---

## Despliegue

**Vercel** funciona sin configurar nada: `vercel.json` ya fija el comando de
build, el directorio de salida y las cabeceras de caché para el modelo y el WASM.

**GitHub Pages** también sirve, porque la salida es estática y no hay funciones
de servidor. El flujo de trabajo `.github/workflows/pages.yml` construye con
`BASE_PATH=/<repo>/` y publica. Todo el código referencia sus activos con
`import.meta.env.BASE_URL`, así que el mismo build vale para la raíz de un
dominio y para una subcarpeta.

Lo único que Pages no da es un dominio propio con HTTPS que ya tengas: si vas a
enseñarlo desde el móvil, Vercel es más cómodo.

---

## Arquitectura

```
src/
  main.ts                 arranque y bucle principal
  camera/stream.ts        getUserMedia, cambio de cámara, ciclo de vida
  tracking/
    landmarker.ts         envoltorio de HandLandmarker
    handedness.ts         asignación estable de rol a cada mano
    types.ts              Landmark, HandFrame, Role
  filter/
    oneEuro.ts            filtro One Euro escalar
    vectorFilter.ts       aplicación a los 21 puntos
  mapping/
    features.ts           normalización y extracción de magnitudes
    scales.ts             escalas y cuantización
    mapper.ts             magnitudes a parámetros de audio
    gate.ts               histéresis de la pinza
  audio/
    engine.ts             grafo de Tone.js, arranque, rampas
    presets.ts            cuatro timbres
  ui/
    overlay.ts            esqueleto de la mano sobre el vídeo
    hud.ts                nota, volumen, latencia, fps
    controls.ts           panel de ajustes
  state/store.ts          estado observable, sin dependencias
```

Por fotograma: la cámara entrega una imagen, el landmarker devuelve de cero a dos
manos, `handedness` asigna los roles, `features` extrae las magnitudes, `mapper`
las convierte en frecuencia, ganancia y corte, y `engine` las aplica con rampas.
El audio no se dispara desde el bucle de render: el bucle actualiza parámetros
continuos, y el gate emite eventos discretos que el motor atiende de inmediato.

### Decisiones que conviene no revisar

- **El modelo y el WASM se sirven desde el propio origen**, nunca desde el CDN de
  Google. `scripts/fetch-assets.mjs` los coloca en `public/` durante la
  instalación y antes de cada build. Es lo que permite funcionar en modo avión
  tras la primera carga. Los 20 MB no se precachean: se cachean en runtime,
  cuando la aplicación los pide por primera vez, para no convertir la primera
  visita en una descarga en frío.
- **Monofónico.** Una sola mano no da información suficiente para varias voces
  independientes, y forzarlo produce un instrumento confuso.
- **`lookAhead` a 10 ms.** El valor por defecto de Tone.js es 100 ms y por sí
  solo destruye la sensación de instrumento.
- **Todo parámetro de audio va por rampa.** Una asignación directa a una
  frecuencia o a una ganancia es una discontinuidad, y una discontinuidad es un
  chasquido.
- **El espejo se resuelve una sola vez.** Si el vídeo se muestra reflejado, la X
  se invierte al salir del detector. Todo lo que hay aguas abajo —mapeo, overlay,
  rejilla— comparte ya el sistema de coordenadas que ve el intérprete.

---

## Sobre el suavizado

El temblor de los puntos de MediaPipe es invisible en pantalla y devastador en
audio: sin filtrar, una nota sostenida suena con un vibrato irregular. Se usa un
**One Euro Filter**, no una media móvil, porque la media móvil añade latencia
constante y con audio se percibe.

Hay tres juegos de parámetros, ajustables en el panel, porque cada señal tolera
una cantidad distinta de retardo:

| Señal | `minCutoff` | `beta` |
| --- | --- | --- |
| Tono | 0.80 | 0.02 |
| Filtro y volumen | 1.20 | 0.01 |
| Puntos del overlay | 1.50 | 0.05 |

El gate de la pinza **no** usa los parámetros de control, y la diferencia se mide:
con `minCutoff` 1.2 y `beta` 0.01 la pinza tarda ocho fotogramas en confirmar el
ataque, 267 ms, más del triple del presupuesto de latencia entero. Con un `beta`
alto el movimiento rápido pasa intacto y el gate confirma en dos fotogramas, que
es el mínimo que impone su propia confirmación. La protección frente al ruido no
la da el suavizado sino la banda muerta entre 0.30 y 0.42.

---

## Criterios de aceptación

Los que se pueden comprobar de forma automática están en `tests/`:

- **Nota sostenida con la mano quieta.** En la configuración por defecto
  (pentatónica cuantizada) la nota no cambia y la deriva es exactamente cero.
  En modo continuo con detección limpia se queda por debajo de tres cents.
  Con detección ruidosa el límite lo pone el detector, no el filtro: bajar
  `minCutoff` de 0.80 a 0.20 solo reduce la deriva de 7.4 a 5.3 cents y a cambio
  añade unos 80 ms de retardo. El filtro no elimina el ruido, lo desplaza a
  frecuencias más bajas, y una deriva lenta sigue siendo deriva.
- **Sin traqueteo en el gate.** Treinta segundos de mano parada en el peor punto
  de la banda muerta, con el temblor real y la cadena real: cero cortes espurios.
- **Perder una mano 300 ms no corta el sonido**, y perderla del todo acaba
  soltando la nota.
- **El ataque llega en dos o tres fotogramas** desde que la pinza se cierra.
- **Recargar conserva** escala, tónica, timbre y ajustes de suavizado.

Los que exigen oído o un dispositivo real —25 fps en un móvil de gama media,
ausencia de chasquidos— no se pueden afirmar desde aquí y quedan por verificar
en hardware.

---

## Fuera del alcance de esta versión

Polifonía y acordes, grabación o exportación a audio y MIDI, multijugador y
gestos entrenables por el usuario. Todo ello queda arquitectónicamente posible,
no implementado.
