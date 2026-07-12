# 🪦 Sistema Web de Gestión de Cementerios (Monorepo)

## 📌 Descripción

Sistema web orientado a la gestión integral de cementerios, permitiendo administrar tumbas, difuntos, reservas, pagos y ubicación mediante geolocalización.

El sistema está diseñado bajo arquitectura cliente-servidor, facilitando la centralización de información y mejorando la experiencia del usuario.

---

## ⚙️ Requisitos

* Node.js (versión LTS recomendada)
* PostgreSQL

---

## 📦 Instalación

### 1. Instalar dependencias

Desde la raíz del proyecto:

```bash
npm run install:all
```

---

### 2. Configurar base de datos

1. Crear archivo `.env`:

```bash
backend/.env
```

2. Basarse en:

```bash
backend/.env.example
```

3. Ejecutar migraciones:

```bash
npm --prefix backend run db:migrate
```

---

## 🚀 Ejecución del sistema

Desde la raíz:

```bash
npm run dev
```

---

### 📍 Servicios

* Frontend: http://localhost:5173
* Backend: http://localhost:3001

Endpoints útiles:

* Health: http://localhost:3001/health
* Health DB: http://localhost:3001/api/health/db

---

## 🔐 Autenticación

Endpoints principales:

* Registro:

```bash
POST /api/auth/register
```

* Verificación:

```bash
POST /api/auth/verify-email
```

* Login:

```bash
POST /api/auth/login
```

* Usuario actual:

```bash
GET /api/auth/me
```

---

## 🔍 Funcionalidades principales

✔ Gestión de tumbas
✔ Registro de difuntos
✔ Búsqueda de difuntos
✔ Visualización de ubicación
✔ Sistema de reservas
✔ Control de pagos
✔ Gestión de usuarios

---

## 🧭 Manual de Usuario

El sistema permite gestionar información funeraria, consultar ubicaciones y realizar operaciones relacionadas con tumbas, difuntos, reservas y pagos mediante una plataforma web intuitiva.

### 🔹 1. Acceso al sistema

El usuario puede ingresar al sistema mediante sus credenciales registradas:

- Correo electrónico.
- Contraseña.

Después de una autenticación correcta, el sistema muestra las opciones disponibles según el rol del usuario.

---

### 🔹 2. Búsqueda de difuntos

El usuario puede localizar información de una persona fallecida mediante el módulo de búsqueda.

Permite consultar:

- Nombre del difunto.
- Información registrada.
- Ubicación dentro del cementerio.
- Sector, fila y columna asignada.

Esta funcionalidad reduce el tiempo necesario para encontrar una tumba físicamente.

---

### 🔹 3. Visualización de ubicación y estado

El sistema permite visualizar la información relacionada con la ubicación funeraria:

- Ubicación geográfica de la tumba.
- Sector correspondiente.
- Estado actual de la tumba.
- Información asociada al registro del difunto.

Estados disponibles:

- Disponible.
- Reservada.
- Ocupada.
- Mantenimiento.

---

### 🔹 4. Gestión de reservas

Los usuarios pueden solicitar la reserva de espacios funerarios disponibles.

Proceso:

1. Consultar tumbas disponibles.
2. Seleccionar una ubicación.
3. Registrar la solicitud de reserva.
4. Consultar el estado de la solicitud.

Estados de reserva:

- Pendiente.
- Aprobada.
- Cancelada.
- Finalizada.

---

### 🔹 5. Gestión de pagos

El sistema permite registrar y consultar pagos asociados a reservas.

Información disponible:

- Código de reserva.
- Usuario asociado.
- Monto.
- Fecha de pago.
- Estado del pago.

---

# 🎓 Guía de Capacitación del Sistema

## Objetivo

Capacitar a los usuarios en el manejo correcto del sistema web, permitiendo realizar búsquedas, reservas, consultas y administración de información funeraria de manera eficiente.

---

## Usuarios capacitados

### 👤 Usuario cliente

Capacitación en:

- Registro e inicio de sesión.
- Búsqueda de difuntos.
- Consulta de ubicación.
- Solicitud de reservas.
- Consulta de pagos.

### 👨‍💼 Administrador

Capacitación en:

- Gestión de usuarios.
- Registro y actualización de tumbas.
- Administración de difuntos.
- Control de reservas.
- Gestión de pagos.
- Consulta de información del sistema.

---

## Plan de capacitación

| Sesión | Tema | Descripción |
|---|---|---|
| 1 | Introducción al sistema | Explicación general de módulos y funcionalidades. |
| 2 | Acceso y usuarios | Registro, autenticación y gestión de perfiles. |
| 3 | Consulta de información | Búsqueda de difuntos y visualización de ubicación. |
| 4 | Reservas | Creación, seguimiento y administración de solicitudes. |
| 5 | Pagos | Registro y consulta de estados de pago. |
| 6 | Administración | Gestión completa del sistema por parte del administrador. |

---

## Recomendaciones de uso

- Mantener actualizada la información registrada.
- Verificar los datos antes de confirmar operaciones.
- No compartir las credenciales de acceso.
- Utilizar un navegador actualizado.
- Reportar errores o inconvenientes al administrador del sistema.

## 🏗️ Arquitectura

El sistema sigue el patrón:

* Modelo → lógica y base de datos
* Vista → interfaz de usuario
* Controlador → gestión de peticiones

---

## 🧩 Organización de módulos (Backend)

Plan de refactor por dominios (Opción A, sin romper endpoints):

- backend/README.md

---

## 🗄️ Base de datos

Principales entidades:

* users
* roles
* graves
* deceased
* reservations
* payments
* sectors
* locations

---

## ⚠️ Notas

* El frontend usa proxy para `/api`
* Se recomienda conexión estable a internet
* Endpoint `/api/health/db` valida conexión a PostgreSQL

---

## 💡 Innovación y valor agregado

* Geolocalización de tumbas
* Centralización de información
* Reducción del tiempo de búsqueda
* Escalabilidad del sistema
* Posible integración futura con:

  * Aplicación móvil
  * Códigos QR
  * Notificaciones automáticas

---

## 👨‍💻 Autor

Proyecto desarrollado como parte del curso de Herramientas de Desarrollo – UTP.
