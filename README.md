# DevJobs

## Conectar MySQL

1. En MySQL Workbench, ejecuta `devjobs_mysql.sql` en tu servidor MySQL 8.
2. Copia el archivo de ejemplo a `.env` desde PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Edita `.env` con los mismos datos de la conexión de Workbench. `DB_NAME` debe ser `devjobs`. Si tu usuario no tiene contraseña, deja `DB_PASSWORD=` vacío.
4. Genera una clave local para los tokens en PowerShell:

   ```powershell
   [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
   ```

   Pega el resultado en `JWT_SECRET`. No compartas ese valor.
5. Instala dependencias y arranca el servidor:

   ```powershell
   npm install
   npm start
   ```

6. Abre `http://localhost:3000/`. La ruta `http://localhost:3000/api/health` debe responder `status: ok` y `database: devjobs`.

El navegador solo habla con Express; las credenciales MySQL permanecen en `.env`, excluido de Git. Las vacantes, cuentas y postulaciones se guardan en MySQL. Para producción, usa HTTPS, limita intentos de acceso y mueve el token de `sessionStorage` a una cookie `HttpOnly`.