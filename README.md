# DevJobs

Portal de empleo para explorar vacantes, consultar empresas y salarios, crear cuentas y publicar puestos. La aplicación combina páginas HTML y recursos estáticos con una API REST en Express y una base de datos MySQL.

## Arquitectura

```text
.
|-- frontend/
|   |-- index.html                 # Página principal
|   |-- Empleos.html               # Búsqueda y listado de empleos
|   |-- DetalleEmpleo.html         # Detalle y postulación
|   |-- Empresas.html
|   |-- Salarios.html
|   |-- IniciarSesion.html
|   |-- Perfil.html                  # Perfil profesional de candidatos
|   |-- PublicarEmpleo.html
|   |-- site-header.js              # Comportamiento compartido del encabezado
|   |-- style.css
|   |-- tailwind.input.css          # Entrada de Tailwind CSS
|   |-- tailwind.css                # Estilos generados
|   |-- tailwind.config.js
|   `-- background.webp
|-- backend/
|   |-- server.js                   # API REST y servidor de archivos estáticos
|   `-- database/
|       `-- devjobs_mysql.sql       # Esquema de la base de datos
|-- .env.example                    # Plantilla de configuración local
|-- package.json
`-- README.md
```

Express sirve el frontend desde `frontend/` y expone la API bajo `/api`. El backend usa MySQL para persistir cuentas, perfiles de candidatos, empresas, vacantes y postulaciones; `bcryptjs` protege las contraseñas y JSON Web Tokens gestionan la autenticación.

## Requisitos

- Node.js 18 o superior y npm.
- MySQL 8.
- MySQL Workbench u otra herramienta para ejecutar el esquema SQL.

## Instalación

1. Clona el repositorio y entra en la carpeta del proyecto.
2. Instala las dependencias y crea el archivo de configuración local:

   ```powershell
   npm install
   Copy-Item .env.example .env
   ```

3. En MySQL Workbench, ejecuta [`backend/database/devjobs_mysql.sql`](backend/database/devjobs_mysql.sql) en tu instancia de MySQL 8. Si ya tenías DevJobs instalado, vuelve a ejecutar el script para crear la tabla del perfil de candidatos; las tablas existentes se conservan.
4. Edita `.env` con la configuración de tu base de datos y genera un secreto para JWT:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"
   ```

   Copia el resultado en `JWT_SECRET`. Debe tener al menos 32 caracteres. No compartas el secreto ni subas `.env` al repositorio.

## Configuración

| Variable | Descripción | Ejemplo |
| --- | --- | --- |
| `PORT` | Puerto HTTP del servidor | `3000` |
| `DB_HOST` | Host de MySQL | `127.0.0.1` |
| `DB_PORT` | Puerto de MySQL | `3306` |
| `DB_NAME` | Base de datos de la aplicación | `devjobs` |
| `DB_USER` | Usuario de MySQL | `root` |
| `DB_PASSWORD` | Contraseña de MySQL; puede quedar vacía si el usuario no tiene contraseña | No se comparte |
| `JWT_SECRET` | Secreto aleatorio para firmar tokens; mínimo 32 caracteres | No se comparte |
| `GMAIL_USER` | Cuenta Gmail que enviará las notificaciones de postulaciones | `tu-cuenta@gmail.com` |
| `GMAIL_APP_PASSWORD` | Contraseña de aplicación de esa cuenta Gmail | No se comparte |

Para enviar las postulaciones al correo de contacto que la empresa indicó en su vacante:

1. Activa la verificación en dos pasos de la cuenta Gmail que enviará los mensajes.
2. Crea una contraseña de aplicación desde la configuración de seguridad de esa cuenta.
3. En `.env`, define `GMAIL_USER` con esa cuenta y `GMAIL_APP_PASSWORD` con una contraseña de aplicación generada por esa misma cuenta. Deben pertenecer al mismo Gmail. No uses la contraseña normal de Gmail ni compartas o subas `.env`.
4. Reinicia el servidor. El destinatario será el correo de contacto guardado en la vacante y podrá responder directamente al correo del candidato.

Si Gmail no está configurado o rechaza el envío, la postulación se guarda igualmente y la aplicación indica que no se pudo enviar la notificación.

## Ejecución

Inicia el servidor en modo desarrollo, con reinicio automático al cambiar archivos:

```powershell
npm run dev
```

Para iniciar el servidor sin el modo de observación:

```powershell
npm start
```

Abre [http://localhost:3000/](http://localhost:3000/) en el navegador. Para regenerar el CSS de Tailwind después de cambiar clases o plantillas, ejecuta:

```powershell
npm run build:css
```

## API principal

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/health` | Comprueba la conexión con la base de datos. |
| `POST` | `/api/auth/register` | Registra una cuenta. |
| `POST` | `/api/auth/login` | Inicia sesión y devuelve un token. |
| `GET` | `/api/auth/me` | Devuelve la cuenta asociada al token. |
| `GET` | `/api/profile` | Consulta el perfil profesional de la cuenta de candidato autenticada. |
| `PUT` | `/api/profile` | Actualiza los datos, las habilidades y el CV del candidato autenticado. |
| `GET` | `/api/profile/resume` | Descarga el CV del candidato autenticado. |
| `GET` | `/api/jobs` | Lista y filtra vacantes publicadas; está disponible para visitantes sin iniciar sesión. |
| `GET` | `/api/jobs/:id` | Consulta una vacante. |
| `POST` | `/api/jobs` | Publica una vacante como empleador autenticado. |
| `POST` | `/api/jobs/:id/applications` | Envía una postulación de una cuenta de candidato autenticada. |

La ruta de salud debe responder con `status: ok` y `database: devjobs` cuando MySQL está disponible.

## Seguridad

Las credenciales y el secreto se guardan localmente en `.env`, que está excluido de Git. En producción, configura HTTPS, usa secretos propios del entorno de despliegue, limita los intentos de autenticación y considera almacenar el token en una cookie `HttpOnly` con las protecciones adecuadas.