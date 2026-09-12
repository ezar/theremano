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

- **Instrumento** — una voz controlada con las dos manos, con cuantización a
  escala para que suene bien desde el primer minuto, vibrato con el temblor de la
  mano y una nota pedal que se deja sostenida para tocar encima.
- **Estación de bucles** — hasta cuatro capas superpuestas, con cuatro pulsos de
  claqueta por delante de la primera. Esa marca el compás; las siguientes se
  graban encima sin esperar a que la vuelta termine.
- **Clip para compartir** — graba imagen y sonido en 9:16, hasta un minuto, con
  la nota y la marca sobreimpresas, y lo entrega por la hoja de compartir del
  móvil o como descarga.
- **Solo manos** — oculta la imagen de la cámara, en pantalla y en el clip: se ve
  el esqueleto sobre un fondo oscuro, sin cara ni habitación. Tecla **V**.
- **Introducción interactiva** — seis pasos que se cierran cuando el gesto ocurre
  de verdad, no cuando se pulsa «siguiente». Repetible desde la ayuda.
- **Demostración** — el instrumento se toca solo, con una mano dibujada, y
  enseña de dónde sale cada nota. **Sin pedir la cámara.**
- **Tocar sin cámara** — el mismo instrumento entero, con el ratón o con el
  dedo moviendo esa misma mano dibujada. Bucles, clip y enlaces incluidos.
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
| Mano de melodía, distancia a la cámara | Espacio: cerca seco, lejos abierto |
| Velocidad al cerrar la pinza | Fuerza con la que entra la nota |
| Oscilar la mano de melodía sobre la nota | Vibrato, al ritmo al que oscilas |
| Mano de expresión, pulgar contra índice *(opcional)* | Nota pedal: sostiene la nota que suena |
| Mano de expresión, altura *(opcional)* | Volumen maestro |
| Mano de expresión, dedos extendidos (1 a 4) *(opcional)* | Timbre |
| Mano de expresión, pulgar contra corazón medio segundo *(opcional)* | Graba una capa de bucle |

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

### Grabar sin tocar nada

Hasta aquí, la única acción musical que seguía exigiendo contacto era grabar una
capa: había que buscar el teclado o el botón. Un instrumento que presume de no
necesitar contacto y te obliga a eso no cumple lo que promete.

Ahora, **pulgar contra corazón en la mano de expresión, medio segundo**, pide un
bucle. Se usa el corazón y no otro dedo porque es el único que se junta con el
pulgar sin arrastrar al índice: con el anular o el meñique la mano entera se
cierra y el gesto se confunde con un puño.

Cuatro reglas, y las cuatro están porque aquí un falso positivo no es un píxel
mal puesto, es una grabación que arranca sola en mitad de lo que estabas tocando:
histéresis como en la pinza que suena; hay que mantenerlo medio segundo, porque
un roce al pasar entre dos dedos no es una decisión; y una vez disparado se queda
trabado hasta que la mano se abre, o seguir con los dedos juntos encadenaría
bucles cada medio segundo. Lo sostenido tampoco sobrevive a perder la mano de
vista: si sobreviviera, bastaría un parpadeo del detector —con el gesto ya
hecho— para completar algo que nadie mantuvo.

Y la cuarta, que se pasó por alto en la primera versión: **el pulgar tiene que
estar claramente más cerca del corazón que del índice**. En una mano de verdad
las puntas del índice y del corazón están a un quinto del tamaño de la mano una
de otra, así que el pulgar posado en el índice queda también por debajo del
umbral del corazón. Sin ese margen, una pinza normal con la mano de expresión
grababa una capa sola. El modelo de mano sintética de las pruebas separaba los
dedos más de lo que lo hace una mano real y no lo enseñaba.

Mientras el gesto está en marcha, el timbre no cambia. Al juntar pulgar y corazón
el corazón se dobla y el recuento de dedos extendidos baja uno; sin esa
salvaguarda, pedir un bucle cambiaría el instrumento de paso.

Y encaja con la claqueta: gesto, cuatro pulsos para colocarse, y a grabar. Un
bucle entero sin tocar nada.

### La distancia a la cámara es el espacio

Sale del tamaño aparente de la mano: acercarse la agranda en el encuadre. No es
profundidad de verdad —el modelo da una z, pero es relativa a la propia mano y no
sirve para esto— y es la única señal de distancia estable que hay aquí.

El tamaño se mide como **la raíz del área del triángulo de la palma**, no como
una distancia, y ahí está el detalle que costó una corrección. Los puntos vienen
normalizados por ancho en x y por alto en y, que en un encuadre 16:9 no son la
misma unidad: una distancia en ese espacio cambia al girar la mano aunque la mano
no se haya movido, y girar la muñeca noventa grados bastaba para recorrer el
rango entero. Un área no tiene ese problema, porque esa normalización multiplica
todas las áreas por el mismo factor sea cual sea la orientación. En la pinza el
problema no existía: allí se dividen dos distancias medidas en el mismo espacio y
la deformación se cancela sola.

Mueve la reverberación y el eco a la vez, porque lo que se busca no es «más
reverb» sino la sensación de alejarse: una sala grande tiene las dos cosas. El
timbre manda: cada preset trae su cantidad de espacio y el gesto la recorre
alrededor, en vez de imponer la suya y borrar la diferencia entre un theremín y
un bajo. Y la rampa es mucho más lenta que la de los demás parámetros: una
reverberación que cambia en treinta milisegundos no suena a moverse por una sala,
suena a un mando que alguien está girando.

### La nota entra con la fuerza con que la cierras

La dinámica venía entera de la otra mano, que es una mano que puede no estar.
Ahora la mano que toca decide también cuánto entra la nota, que es como se
comporta cualquier instrumento: no es lo mismo posar los dedos que dejarlos caer.

Se mide sobre la señal ya filtrada, la misma que decide la puerta: sobre la
cruda, el ruido del detector se colaría como fuerza y dos notas iguales sonarían
distinto sin motivo. Se fija en el ataque y dura toda la nota, porque
recalcularla por fotograma convertiría un matiz de entrada en un temblor de
volumen. Y el suelo no es cero: una nota que no suena porque se cerró despacio se
lee como un fallo del instrumento, no como un matiz.

**La velocidad se mide en una ventana de tiempo fija, no entre dos fotogramas.**
La primera versión hacía lo segundo y tenía dos problemas: la puerta confirma con
dos fotogramas de retraso, así que lo que se medía no era el gesto sino el rebote
que le quedaba al filtro; y dependía de los fotogramas por segundo, con lo que el
mismo gesto daba dos fuerzas distintas según lo cargado que fuera el teléfono —de
0,59 a 0,75, que se oye—. Con una ventana en segundos, la dispersión entre 30,
60 y 120 fps se queda por debajo del 5%. No baja a cero, y no puede: esos dos
fotogramas de confirmación caen en puntos algo distintos de la trayectoria.

El riel de volumen del HUD sigue mostrando la mano, no la ganancia real. Si
mostrara la ganancia, saltaría en cada nota sin que nadie haya movido nada.

### El temblor de la mano es el vibrato

Es el gesto que define a un theremín y hasta ahora no hacía nada. El instrumento
tenía una sola forma de mover una nota ya empezada —subirle o bajarle el brillo—
y ninguna de darle vida sin cambiarla de altura.

Lo delicado no es medir la oscilación, es distinguirla de las otras dos cosas que
hace la misma mano en el mismo eje: **viajar** hasta la nota siguiente, que es un
movimiento grande y en una sola dirección, y **temblar** porque una mano en el
aire tiembla, que es pequeño y rapidísimo. Por eso no basta con la amplitud: se
cuentan además los cruces por el centro de la ventana, y solo cuenta lo que
oscila entre tres y nueve veces por segundo. Un viaje no cruza; el ruido del
detector cruza demasiado. Hay una prueba para cada uno de los tres casos.

**Se mide sobre la x cruda, no sobre la filtrada**, y esa es la parte bonita. El
filtro del tono existe precisamente para borrar esto: a cinco hercios deja pasar
menos de la sexta parte, que es lo que evita que oscilar la mano mueva la nota de
zona. Lo que para el tono es ruido, para el vibrato es la señal. Una prueba pone
la mano justo en el borde entre dos zonas y comprueba las dos mitades a la vez:
que en crudo cruza el borde en cada ciclo, y que la nota que suena no se mueve.

El ritmo también lo manda la mano: se oye el temblor que se está haciendo y no
uno parecido que traiga el timbre. Y la profundidad se suma a la del timbre en
lugar de sustituirla, porque el theremin ya vibra un poco solo y quitárselo lo
dejaría más plano que antes mientras la mano está quieta.

Entra deprisa y se va despacio, como el vibrato de cualquier instrumento de
cuerda: se empieza a oscilar y aparece, se para y se apaga solo.

La demostración acaba ondulando la última nota, que es la única forma de enseñar
esto: las notas se ven llegar, pero un temblor no se deduce mirando tocar.

### Una nota se puede dejar sostenida

Hasta aquí el instrumento era monofónico de verdad: una nota cada vez, y lo único
que podía sonar a la vez era una capa ya grabada. Con la pinza de la otra mano
—pulgar contra índice, la misma que abre una nota— **la nota que esté sonando se
queda sostenida** mientras se aguante, y la mano que toca queda libre para hacer
una melodía encima. Es el salto de «tocar notas sueltas» a «tocar sobre algo».

Es un pedal, no un interruptor: mientras se aguanta, suena; al soltar, se va. No
hay nada que arrancar ni que parar, ni un estado que se pueda quedar colgado, y
es el mismo modelo que la propia llave de la nota.

Cuatro cosas que hacen que no estorbe:

- **Se sostiene lo que suena, no lo que hay debajo de la otra mano.** Si no hay
  nota, el gesto no hace nada; nunca inventa una nota que nadie estaba tocando.
- **Pedir un bucle no lo enciende de paso.** El pulgar pasa cerca del índice de
  camino al corazón, y esa es exactamente la pinza del pedal. Mientras el gesto
  de grabar está en marcha, el pedal no escucha. Hay una prueba con las dos
  distancias por debajo del umbral a la vez —lo peor que puede pasar— y el pedal
  no se enciende.
- **Poner el pedal no cambia el timbre.** Al juntar pulgar e índice, el índice se
  dobla y el recuento de dedos extendidos baja uno. Es la misma guarda que ya
  tenía el gesto de grabar, ahora para los dos.
- **Nadie sostiene una nota sin manos.** Perder la mano de expresión, o irse de
  la pestaña, suelta el pedal.

Suena por el mismo camino que la melodía —mismo vibrato, mismo filtro, mismo
espacio, mismo volumen— porque es la misma voz sostenida y no otro instrumento
pegado al lado. Entra y sale más despacio que una nota: un pedal que aparece de
golpe suena a error. Y va por debajo en volumen, que es lo que hace que siga
siendo un acompañamiento.

Lo que **no** hace: no entra en las capas de bucle. Lo sostiene la mano, no el
bucle, así que una capa grabada con el pedal puesto guarda la melodía y no el
pedal.

Sin cámara funciona igual, con el botón derecho del ratón o con un segundo dedo:
es una segunda mano dibujada, y entra por el mismo sitio. Con ratón se dibuja al
lado de la primera —un solo puntero para dos manos— y a la altura que ya tiene el
volumen, para que poner un pedal no lo cambie de paso.

### El cambio de timbre se ve venir

El gesto de los dedos existía desde el principio y no lo encontraba nadie: solo
se sabía de él leyendo la ayuda. Ahora, en cuanto los dedos apuntan a otro
timbre, el chip de abajo a la izquierda lo anuncia —«Theremín → Flauta»— con una
barra que se llena mientras el recuento se sostiene, y que se vacía si la mano
titubea. El nombre asoma al primer fotograma; confirmar sigue exigiendo la misma
racha de seis, porque un recuento de dedos parpadea en los bordes del gesto y un
timbre que cambia solo es desconcertante.

Ver el nombre asomar convierte un dato de la documentación en algo que se
descubre por accidente, que es como se aprende un instrumento. El sexto paso de
la introducción, opcional, remata la faena: se cierra solo cuando el cambio de
timbre ocurre de verdad, no cuando se levantan dedos.

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

## Sobre tocar sin cámara

El permiso de cámara es la puerta donde se queda la mitad de la gente, y hasta
ahora detrás de esa puerta no había nada: ni instrumento, ni forma de probarlo.
La demostración resolvió la mitad —ver cómo se toca— y esto resuelve la otra:
tocarlo.

El puntero mueve la palma de la mano dibujada, que es lo que decide la nota, y
pulsar cierra la pinza. **De ahí para adelante el camino es el de siempre**: el
mismo gate con su histéresis, la misma cuantización a la escala, la misma fuerza
de ataque, el mismo bucle de fotogramas y la misma estación de bucles. No es un
modo recortado ni un juguete aparte: es el instrumento con otra entrada, con su
HUD, su barra de acciones, sus clips y sus enlaces.

Tres decisiones que no son evidentes:

- **Un toque en otro sitio es una mano nueva, no una mano que viaja.** Con el
  dedo, cada nota es un toque en un punto distinto de la pantalla. El filtro del
  tono —que existe para limar el temblor de una mano de verdad— no distingue un
  salto de un movimiento rapidísimo, y llegaría a la nota nueva dos décimas
  después de que el gate haya abierto: sonaría la zona de la que se venía. Al
  pulsar lejos de donde estaba la mano se emite **un fotograma sin mano**, que es
  exactamente lo que ocurre cuando una mano sale del encuadre y vuelve a entrar,
  y ese camino ya pone los filtros a cero. Sin esto, la segunda nota de una
  prueba de dos toques sale una octava por debajo; hay un test que lo comprueba.
  Con el ratón, en cambio, pulsar donde ya está el puntero no pierde nada: el
  filtro venía siguiéndolo.
- **La pinza no se cierra de golpe.** La fuerza del ataque sale de lo rápido que
  se cierra, y un salto instantáneo la satura: todas las notas entrarían al
  máximo. Ochenta milisegundos dan una entrada firme sin llegar al tope, y se
  notan menos que la latencia de la cámara, que es a lo que sustituyen.
- **Las pulsaciones las recibe el lienzo, no la pantalla entera.** Los botones
  del HUD están por encima, así que pulsar «grabar» sigue siendo pulsar un botón
  y no tocar una nota de paso. Y solo manda un puntero a la vez: un segundo dedo
  apoyado en la pantalla no mueve la mano.

La introducción guiada no aparece en este modo: habla de dos manos, de dedos
levantados y de gestos que aquí no existen, y un paso que no se puede completar
es peor que no tener introducción. Queda sin ver, así que aparecerá entera el día
que se entre con cámara.

Cuando la cámara falla, el botón deja de ser la letra pequeña: se enciende y la
pantalla lo dice, porque quien acaba de ver un error de permisos necesita saber
que le queda una salida.

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

## Sobre la demostración

La primera pregunta de quien llega no es cómo suena, es qué tiene que hacer con
las manos. Contarlo con palabras cuesta un párrafo; enseñarlo cuesta quince
segundos. El botón está en la pantalla inicial, debajo de empezar, y **no pide
permiso de cámara**: se arranca solo el audio, igual que al escuchar un enlace.

Lo que se ve no es un vídeo grabado ni una animación aparte. Es una mano de
veintiún puntos colocados a mano —`tracking/phantom.ts`— que entra en el mapeador
por la misma puerta que una mano detectada, y a partir de ahí todo ocurre solo:
el gate, la cuantización a la escala, el portamento, la fuerza de cada nota, la
rejilla, el anillo de la pinza y las partículas. **La demostración no simula el
instrumento, lo toca.** Si algún día se desafina, se desafina con él; y no hay
ningún vídeo que regrabar cada vez que cambia la pantalla.

La coreografía —`mapping/demo.ts`— toca cada nota en cinco tiempos, que son los
cinco que hace una mano: viajar hasta la zona con la pinza abierta (moverse no
suena), esperar un momento, cerrar la pinza (ahí entra la nota), sostener y
abrir. Mientras tanto la mano pasea despacio arriba y abajo, que es el eje del
brillo, y se ladea un poco para no parecer una pegatina.

Dos cosas que parecen detalles y no lo son:

- **La espera antes de cerrar la pinza.** El filtro del tono tarda unas dos
  décimas en asentarse con la mano quieta, así que después de un salto grande
  todavía queda error suficiente para caer en la zona de al lado. Con una espera
  corta, la tercera nota de «Estrellita» —que sube una quinta de golpe— sonaba un
  grado por debajo. Una prueba toca las diez melodías enteras y compara nota a
  nota: el fallo que vigila no es el silencio, es la nota equivocada, que se oye
  perfectamente y está mal.
- **La mano se ladea hacia dentro en los extremos del recorrido.** Una mano a
  distancia de trabajo ocupa buena parte del ancho de un móvil en vertical, así
  que con la palma en la nota más grave el pulgar y el índice se quedaban fuera
  del encuadre: justo los dos que hay que mirar. Ladearla los mete dentro sin
  mover la palma, que es la que decide la nota, y es lo que hace cualquiera que
  toque esto con el teléfono delante. El ladeo va al cubo de la distancia al
  centro, así que la mano va derecha por todo el centro del recorrido y solo se
  angula en los últimos pasos. Se dibuja además un poco más lejos de la cámara
  que una mano a distancia de trabajo, por el mismo motivo.

La pinza se construye al revés que el resto de la mano. En vez de doblar los
dedos y ver qué distancia queda, se decide primero dónde se encuentran las dos
puntas y a qué distancia están, y después se rellenan los nudillos que faltan.
Es la única forma de que una pose de 0,2 abra la nota y una de 0,5 no, sin
depender de la proporción de la ventana: los puntos normalizados dividen x por el
ancho e y por el alto, que en apaisado no son la misma unidad.

Los cinco dedos se dibujan igual: un arco desde el nudillo hasta la punta, con
los nudillos de en medio repartidos por longitud de hueso, y el arco se abre
justo lo que sobra de dedo. Es lo que hace que la mano parezca una mano. La
primera versión doblaba cada falange por su ángulo y resolvía el índice con dos
circunferencias, para conservar la longitud exacta de cada hueso, y salía un
garabato: el codo del índice saltaba de un lado a otro —un rayo en vez de un
dedo— y los otros tres se torcían hacia el meñique como un rastrillo. Un dedo que
se cierra va hacia la palma, que es hacia la cámara, y de frente eso se ve como
un dedo más corto y algo arqueado, no como un dedo que se tuerce de lado.

Si hay una melodía elegida, se toca esa; si no, «Estrellita», que se reconoce en
dos notas y cabe en una octava. En cualquier caso queda elegida al salir, así
que quien entre después se encuentra guiada la que acaba de ver.

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
timbres que existan, recuentos que cuadren, no más capas de las que se pueden
reproducir, notas enteras, eventos dentro del ciclo y ni un byte de sobra al
final. Medio bucle reconstruido de un enlace roto sonaría a fallo del
instrumento.

Lo de «notas enteras» tiene truco. Una capa con solo parámetros no llega a atacar
ni una nota, y dejaría el enlace anunciando que suena algo que no suena; un
ataque sin su suelta deja la nota abierta y, como cada vuelta la vuelve a atacar,
se convierte en un bordón que ya no para. Pero la comprobación tiene que ser
**circular**: `LoopTake.finish()` ordena los eventos por tiempo, así que una
sobregrabación que empieza a mitad de vuelta acaba con la suelta *antes* que su
ataque en el array, porque la nota cruza el final del ciclo. Exigir que empiece
por un ataque rechazaría capas perfectamente legítimas. Lo que se exige es que
ataques y sueltas se alternen al dar la vuelta.

Hay un enlace de la versión 1 guardado en las pruebas. No comprueba que el
codificador siga produciendo esos mismos bytes —cambiar el remuestreo por dentro
es legítimo— sino que se sigue pudiendo leer: romper los enlaces que ya están
circulando por ahí, no.

---

## Sobre la claqueta

La primera capa define el compás de todo lo que venga después, y ese compás
empezaba en el instante del pulsado. Con las manos en el aire eso es una carrera:
hay que estar ya colocado, con la pinza donde toca y la nota pensada, antes de
tocar el botón. Cuatro pulsos por delante convierten esa carrera en una entrada.

Solo la primera. En una sobregrabación el ciclo ya existe y la toma entra donde
esté el cabezal; contar por delante ahí solo desplazaría la capa.

El tempo lo pone la aplicación —90 por minuto— porque no hay ninguno todavía:
nadie ha marcado un compás aún. Es lento a propósito, y hay una prueba que lo
defiende: por debajo de medio segundo por pulso no da tiempo a levantar la mano y
encontrar la nota, que es justo para lo que existe esto.

Volver a pulsar durante la cuenta la cancela. Sin eso, quien se arrepiente o
pulsa sin querer se queda esperando a que termine para poder deshacerlo.

Dos detalles que costaron encontrarse:

- **El primer pulso no se puede programar en el instante del pulsado.** Para
  cuando el hilo de audio llega a atenderlo, ese instante ya pasó, y un evento en
  el pasado se descarta sin avisar. Va veinte milisegundos por delante, que no se
  oyen.
- **La cuenta termina en el bucle de fotogramas, no en un temporizador.** El
  instante que cuenta no es cuándo se ejecuta el código sino el que se guarda
  como inicio de la toma, que es el del pulso; así, si el navegador reparte mal
  sus avisos, la capa sigue empezando donde debe. Y un temporizador sería una
  pieza más que cancelar, que limpiar y que podría dispararse sobre una estación
  ya vaciada.

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
    phantom.ts            mano sintética para la demostración
  filter/
    oneEuro.ts            filtro One Euro escalar
    vectorFilter.ts       aplicación a los 21 puntos
  mapping/
    features.ts           normalización y extracción de magnitudes
    scales.ts             escalas y cuantización
    mapper.ts             magnitudes a parámetros de audio
    gate.ts               histéresis de la pinza
    pointer.ts            tocar con el ratón o con el dedo
    vibrato.ts            el temblor de la mano, separado del viaje
    melodies.ts           melodías guiadas y progreso
    demo.ts               coreografía de la demostración
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
- **La nota pedal sostiene lo que suena y nada más.** Sin nota no hace nada, no
  se enciende al pedir un bucle aunque las dos pinzas caigan bajo el umbral a la
  vez, no cambia el timbre de paso, y se suelta al perder la mano o la pestaña.
- **Oscilar la mano da vibrato; viajar a otra nota y el temblor del detector, no.**
  Y con la mano puesta en el borde entre dos zonas, la oscilación cruza ese borde
  en crudo en cada ciclo y la nota que suena no se mueve.
- **Con el puntero, la nota que suena es la de donde se ha pulsado.** Dos toques
  en zonas lejanas dan las dos notas correctas, igual a 30 que a 60 fotogramas;
  arrastrar con el botón pulsado es un glissando y no una nota nueva; y la pinza
  no se cierra de golpe, así que el ataque no sale saturado.
- **La demostración toca las diez melodías nota por nota**, con la mano de
  mentira entrando por el mapeador de verdad, igual a 30 que a 60 fotogramas y
  con la ventana apaisada o vertical. Y la mano cabe entera en el encuadre en los
  dos extremos del recorrido.
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
