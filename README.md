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

## Qué hace

Se toca en el aire, se graba por capas y se sale de ahí con un vídeo. Está en
**español e inglés**, y sigue al idioma del navegador salvo que se elija otro.

- **Instrumento** — una voz monofónica controlada con las dos manos, con
  cuantización a escala para que suene bien desde el primer minuto.
- **Estación de bucles** — hasta cuatro capas superpuestas. La primera marca el
  compás; las siguientes se graban encima sin esperar a que la vuelta termine.
- **Clip para compartir** — graba imagen y sonido en 9:16, hasta un minuto, con
  la nota y la marca sobreimpresas, y lo entrega por la hoja de compartir del
  móvil o como descarga.
- **Solo manos** — oculta la imagen de la cámara, en pantalla y en el clip: se ve
  el esqueleto sobre un fondo oscuro, sin cara ni habitación. Tecla **V**.
- **Introducción interactiva** — cinco pasos que se cierran cuando el gesto
  ocurre de verdad, no cuando se pulsa «siguiente». Repetible desde la ayuda.
- **Melodías guiadas** — diez secuencias que seguir, con el objetivo marcado
  sobre la rejilla: cinco canciones conocidas y cinco ejercicios. Sin presión de
  tiempo: se sigue el orden, no el compás.
- **Enlace con la configuración** — escala, tónica y timbre viajan en el
  fragmento de la dirección, y el enlace trae vista previa al compartirlo.
- **Enlace con lo que tocaste** — lo grabado en la estación de bucles cabe en la
  propia dirección. Quien la abre lo oye sintetizado en su navegador, **sin dar
  permiso de cámara**, y puede tocar encima con un botón.

---

## Cómo se toca

| Gesto | Efecto |
| --- | --- |
| Mano de melodía, posición horizontal | Altura de la nota, dos octavas de izquierda a derecha |
| Pulgar contra índice | Llave: junta para que suene, separa para callar |
| Mano de melodía, altura | Corte del filtro paso bajo: arriba brillante, abajo oscuro |
| Mano de expresión, altura *(opcional)* | Volumen maestro |
| Mano de expresión, dedos extendidos (1 a 4) *(opcional)* | Timbre |

**La segunda mano es opcional, y no es «la izquierda».** El código no distingue
manos físicas: asigna dos roles —melodía y expresión— por posición y continuidad
espacial entre fotogramas. La etiqueta de lateralidad de MediaPipe no se usa en
ningún momento: es inestable cuando la mano gira o se sale del encuadre, y
además describe anatomía, así que un zurdo recibiría un reparto que no puede
cambiar.

Con una sola mano a la vista, esa mano es la de melodía, sea cual sea. Con dos a
la vez desde el principio, toca la melodía la que esté más a la derecha del
encuadre —la derecha del intérprete, porque el vídeo va en espejo— y a partir de
ahí cada mano conserva su rol por continuidad. El reparto se corrige cruzando
las manos, que es algo que el intérprete controla.

Con una mano se toca el instrumento entero. La segunda solo añade volumen y
cambio de timbre, y las dos cosas están también en el panel de ajustes. Perder
una mano no silencia nada: su último estado se conserva 500 ms antes de darla por
ausente, y el volumen se queda donde estaba en lugar de caer a cero.

Con teclado: **espacio** graba una capa de bucle, **C** graba un clip, **Z**
quita la última capa, **V** oculta o muestra la cámara, **H** abre la ayuda.

### Solo manos

Se puede tocar y grabar sin que salga nada más que las manos. El modo no
difumina el fondo ni recorta una silueta: sencillamente no dibuja el fotograma
de la cámara, ni en la pantalla ni en el lienzo del clip. Lo que queda es el
esqueleto sobre un degradado.

Esa diferencia importa. Un desenfoque o una máscara de segmentación son
estimaciones, y fallan justo cuando peor viene —un giro brusco, un contraluz—
dejando ver medio rostro durante unos fotogramas. Aquí no hay nada que estimar:
los píxeles de la cámara no llegan a pintarse. El vídeo sigue decodificándose
porque el seguimiento lee de él, pero se queda a opacidad cero debajo de un
fondo opaco.

La rejilla se dibuja algo más marcada en este modo: los valores originales se
calibraron contra una imagen de cámara y sobre negro casi desaparecían.

---

## Sobre los idiomas

Todo el texto visible vive en `src/i18n/`, fuera de los módulos que hacen el
trabajo. El tipo `Strings` obliga a que los dos idiomas tengan exactamente las
mismas claves: una traducción a medias no compila.

La notación de las notas forma parte de la traducción. El mundo hispanohablante
lee Do Re Mi y el anglosajón C D E, y ver la notación equivocada convierte la
rejilla en ruido para quien sabe algo de música.

El panel de ayuda se construye desde el diccionario en lugar de estar escrito en
el HTML. Dos idiomas escritos a mano en el documento se desincronizan a la
primera corrección que se hace solo en uno.

El identificador de cada control sale de una clave fija y no de su etiqueta: si
dependiera del rótulo, cambiar de idioma renombraría todos los controles.

---

## Sobre la introducción

Un instrumento que se toca con gestos no se aprende leyendo. «Junta el pulgar y
el índice» en una lista de la pantalla inicial se salta sin leer, y quien lo lee
tampoco sabe todavía si lo está haciendo bien.

Por eso cada paso se cierra **cuando el gesto ocurre de verdad**, medido sobre las
mismas señales que mueven el instrumento: no hay botón de «siguiente», el botón
es la mano. Y no bloquea nada, porque la única forma de practicar un gesto es
teniendo el instrumento vivo mientras se practica.

Se marca como vista tanto si se completa como si se salta —insistir con algo ya
rechazado es la forma más rápida de molestar— y se puede repetir en cualquier
momento desde el panel de ayuda, al que se llega con el botón **?** o con **H**.

---

## Sobre las melodías guiadas

Sin ellas el instrumento solo permite divagar, y divagar cansa en dos minutos.
Una secuencia que seguir da una razón para volver y convierte un clip en algo que
se puede terminar en lugar de cortar.

**No hay presión de tiempo, y es deliberado.** La latencia de la cámara ronda los
60 ms y el gate necesita dos fotogramas para confirmar; exigir precisión rítmica
encima de eso sería injusto. Se sigue el orden de las notas, no el compás. Fallar
tampoco retrocede: castigar el error en un instrumento que se toca en el aire
solo consigue que se abandone.

Las melodías se declaran en semitonos sobre la tónica y se resuelven contra la
escala activa buscando la zona más cercana, así que cualquiera se puede tocar en
cualquier escala sin quedarse sin notas.

Hay de dos clases. Los **ejercicios** —subir, ida y vuelta, llamada y respuesta,
blues, saltos de octava— son patrones de escala escritos para esto, sin nada
transcrito. Las **canciones** —Oda a la alegría, Cumpleaños feliz, Estrellita,
Martinillo, Greensleeves— son tradicionales o de dominio público, y de ellas solo
está aquí la línea melódica en grados, sin ritmo.

Tres detalles de cómo se escriben:

- **Ninguna nota baja de la tónica.** El encuadre empieza justo ahí y una nota
  más grave no tendría zona donde caer, así que las que empiezan por debajo van
  transportadas una quinta o una octava arriba. En un instrumento sin afinación
  fija eso no cambia nada.
- **Cada nota existe exacta en la escala que la melodía sugiere.** La búsqueda de
  la zona más cercana no falla nunca, pero suena la nota de al lado: en un
  ejercicio da igual, en una canción conocida es la diferencia entre reconocerla
  y no. Una prueba lo comprueba melodía por melodía.
- **Cada melodía declara cuántas octavas necesita**, y elegirla amplía el rango
  si el encuadre se ha quedado corto. Con una sola octava, dos notas distintas de
  «Cumpleaños feliz» caerían en la misma zona. Solo se amplía: quien toca con
  cuatro octavas no las pierde por elegir una melodía.

Greensleeves va en su versión eolia, con séptima menor. La escala menor de la
aplicación no tiene sensible, y forzarla dejaría esa nota cayendo en la zona de
al lado; además es como se ha tocado durante siglos.

---

## Sobre el enlace con lo que tocaste

La estación de bucles no graba audio, graba gestos, y esa decisión es la que hace
posible esto: una interpretación cabe en unos cientos de bytes, y unos cientos de
bytes caben en una dirección. No hay fichero que subir ni servidor donde dejarlo.

Quien abre ese enlace se encuentra la pantalla inicial cambiada, con un botón de
**Escuchar** por delante del de empezar. Escuchar arranca solo el audio: ni
cámara, ni modelo, ni bucle de fotogramas. Eso importa más de lo que parece,
porque el permiso de cámara es la puerta donde se queda la mitad de la gente, y
aquí se puede oír lo que te han mandado antes de decidir si entras.

El formato es binario y va en base64 de direcciones. Seis bytes por evento: el
tipo y el instante empaquetados en dieciséis bits, la altura en centésimas de
semitono, y un byte para el brillo y otro para el volumen. Al reproducir, cada
parámetro es una rampa hasta el siguiente y no un salto, así que se puede
remuestrear a 10 Hz sin escalonar el sonido: un glissando sigue siendo un
glissando. Si aun así no cabe en 1400 bytes, se baja a 5 Hz, y solo entonces se
empiezan a soltar capas.

Lo que se decodifica viene de una dirección que cualquiera puede escribir a mano,
así que se valida entero y se rechaza en bloque: versión, duración del ciclo,
timbres que existan, recuentos que cuadren, eventos dentro del ciclo y ni un byte
de sobra al final. Medio bucle reconstruido de un enlace roto sonaría a fallo del
instrumento.

Hay un enlace de la versión 1 guardado en las pruebas. No comprueba que el
codificador siga produciendo esos mismos bytes —cambiar el remuestreo por dentro
es legítimo— sino que se sigue pudiendo leer: romper los enlaces que ya están
circulando por ahí, no.

---

## Sobre los bucles

La estación de bucles no graba audio: graba los gestos. Cada capa es una lista de
eventos de control que se vuelven a sintetizar en cada vuelta sobre una voz
propia.

La alternativa habitual —grabar con `MediaRecorder` y reproducir en bucle— tiene
tres problemas que así no existen: el códec añade un silencio al principio y al
final que se oye como un hueco en cada vuelta, la memoria crece con la duración,
y una capa grabada es una foto muerta. Con eventos, el bucle empalma exacto y
pesa unos pocos kilobytes.

El precio es que esto introduce polifonía, que la v1 dejaba fuera a propósito.
Pero la voz en directo sigue siendo una sola: lo que suena a la vez son
grabaciones del propio intérprete, que es exactamente lo que hace un pedal de
bucles.

---

## Sobre el clip

Se graba sobre un lienzo aparte, no sobre el de la pantalla. Cuesta un dibujado
extra por fotograma mientras dura, y a cambio el vídeo sale en vertical desde una
cámara apaisada, a resolución fija, sin depender del tamaño de la ventana ni de
la densidad del dispositivo.

Se prefiere MP4 sobre WebM cuando el navegador lo permite, porque es lo único que
Safari en iOS acepta pasar a otras aplicaciones; un WebM allí se queda en el
carrete sin poder subirse a ningún sitio.

El vídeo lleva la dirección impresa. Es la única pieza de todo esto que existe
por una razón que no es musical: un vídeo compartido sin la dirección es un
callejón sin salida para quien lo ve.

La imagen de vista previa del enlace se genera con `npm run og` y se versiona.
Su dirección en las etiquetas es **absoluta**, deducida en tiempo de build del
entorno de despliegue (`SITE_URL`, las variables de Vercel, o el owner del
repositorio en Pages): los rastreadores sociales no resuelven rutas relativas
como hace un navegador, y con una ruta relativa la tarjeta se queda sin imagen.

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
npm run icons   # regenera los iconos de la PWA
npm run og      # regenera la imagen de vista previa al compartir
```

---

## Despliegue

**Vercel** funciona sin configurar nada: `vercel.json` ya fija el comando de
build, el directorio de salida y las cabeceras de caché para el modelo y el WASM.

**GitHub Pages** también sirve, porque la salida es estática y no hay funciones
de servidor. El flujo de trabajo `.github/workflows/pages.yml` construye con
`BASE_PATH=/<repo>/` y publica en cada push a `main`; también se puede lanzar a
mano desde la pestaña *Actions*. El requisito previo es tener Pages habilitado en
*Settings → Pages → Source: GitHub Actions*: sin eso el workflow falla en el paso
`actions/configure-pages`, que es lo único que le falta a un fork recién hecho. Todo el código referencia sus activos con
`import.meta.env.BASE_URL`, así que el mismo build vale para la raíz de un
dominio y para una subcarpeta.

La diferencia entre las dos está en las cabeceras. El despliegue pesa 31 MB y un
visitante nuevo se descarga unos 19 MB: el modelo y una variante del WASM. En
Vercel esos ficheros van con `immutable` y un año de caché. Pages no permite
cabeceras propias, así que los revalida a menudo; el service worker lo tapa a
partir de la segunda visita, pero la primera es peor. Con el límite blando de
100 GB al mes de Pages salen unas 5.000 primeras visitas, de sobra para una
prueba conceptual. Si el repositorio es privado, Pages necesita plan de pago.

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
    onboarding.ts         pasos de la introducción, sin DOM
    coach.ts              tarjeta de la introducción
    help.ts               panel de ayuda
    overlay.ts            esqueleto de la mano sobre el vídeo
    hud.ts                nota, volumen, latencia, fps
    controls.ts           panel de ajustes
  state/store.ts          estado observable, sin dependencias
  i18n/                   todo el texto visible, en español e inglés
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
- **Una capa de bucle nunca deja una nota colgada** ni coloca eventos fuera del
  ciclo, tampoco grabando a caballo entre dos vueltas; una toma sin notas se
  descarta en lugar de dejar una capa fantasma.
- **Un enlace manipulado no impide arrancar**: se aplica lo que se reconoce y se
  descarta el resto, y un fragmento sin tónica no inventa una.
- **Ningún idioma tiene cadenas vacías**, los dos cubren todas las escalas,
  timbres, melodías y pasos, y el español conserva sus tildes y sus eñes.
- **Solo el paso de la segunda mano está marcado como opcional**, y la marca vive
  en el dato para que la tarjeta pueda anunciarla antes de que nadie lo intente.
- **Ningún paso de la introducción se cierra solo**: cada uno se prueba con la
  señal que le toca y con todo lo demás moviéndose menos esa señal.
- **Una melodía guiada se puede completar en cualquier escala** que reparta el
  encuadre en zonas, y cambiar de escala a mitad no pierde el progreso. En modo
  continuo no hay zonas, así que la guía se retira sola en lugar de quedarse
  puesta y muerta.

Los que exigen oído o un dispositivo real —25 fps en un móvil de gama media,
ausencia de chasquidos— no se pueden afirmar desde aquí y quedan por verificar
en hardware.

---

## Fuera del alcance

Acordes tocados en directo, exportación a MIDI, multijugador y gestos entrenables
por el usuario. Queda arquitectónicamente posible, no implementado.

## Lo que esto no es

Nada de aquí garantiza que el proyecto circule. Lo que se ha hecho es quitar las
razones por las que no podía: antes no salía nada del navegador, y ahora sale un
vídeo vertical con la dirección impresa. Que alguien quiera enseñarlo depende de
que tocarlo sea divertido, y eso solo lo dice una cámara con manos delante.
