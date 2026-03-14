# 🔐 AgriOps api

<p>
Auth Service is a backend microservice of the <strong>AgricultureOperations platform</strong>, responsible for managing authentication and authorization.

The service is built using <strong>Express.js</strong> with <strong>Node.js 24</strong>, and <strong>TypeScript</strong> and follows a <strong>Layered Architecture</strong> approach to ensure clear separation between repositories(data access), services(business logic) and controllers(API Layer). 
</p>

---

## 🚀 Features

- User registration and login with secure password hashing (bcrypt)

- Users list endpoint

- JWT-based authentication and authorization

- Layered architecture for maintainability and scalability

- Unit, integration, and end-to-end testing with Jest and Supertest

- TypeScript strict typing for safer code

- Environment variable configuration with `.env`

- Clean folder structure following best practices

- SQLite persistence layer

- Lightweight database using better-sqlite3

- Docker containerization support

---

## 🛠 Tech Stack

- Node.js

- Express

- TypeScript

- Docker

- SQLite

- better-sqlite3

- JSON Web Tokens (JWT)

- bcrypt

- Jest (Unit testing)

- Supertest (Integration & E2E testing)

---

## 🧱 Architecture Overview

The service follows Layered Architecture composed of Controllers, Services, and Repositories. Each layer has a specific responsibility to ensure separation of concerns, maintainability, and testability.

### Layers

- Controller
  The Controller handles HTTP requests and responses.

- Service
  The Service contains the business logic of the application.

- Repository
  The Repository is responsible for data access.

---

## 📁 Project Structure

```bash
Dockerfile
.dockerignore
src/
 ├── controllers/        # Handle HTTP requests and responses
 ├── services/           # Business logic (rules, validations, operations)
 ├── routes/             # Define API endpoints
 ├── middlewares/        # Middleware (authentication, error handling, validation)
 ├── repositories/       # Data access
 ├── models/             # Data models and types
 ├── data/               # Mock data or database connections
 ├── app.ts              # Express app initialization and middleware setup
 └── server.ts           # Entry point: server startup

test/
 ├── unit/               # Unit tests for services and utilities
 ├── integration/        # Integration tests for routes and controllers
 └── e2e/                # End-to-end tests simulating full flows
```

---

## 🔄 Request Flow

```bash
Client Request
      │
      ▼
Controller (HTTP Layer)
      │
      ▼
Service (Business Logic Layer)
      │
      ▼
Repository (Data Access Layer)
      │
      ▼
SQlite Database
```

---

## 🗄 Database

The repository uses SQLite as a lightweight embedded database for local development.

Example connection string:

```bash
Database("database.db");
```

---

## 🔑 Authentication Endpoints

### 1. Register new user

`POST /auth/registe`

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "yourPassword123"
}
```

**Response:**

```json
{
  "id": "uuid",
  "email": "user@example.com"
}
```

### 2. Login user

`POST /auth/login`

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "yourPassword123"
}
```

**Response:**

```json
{
  "token": "jwt.token.here"
}
```

### 3. Get users (Protected route)

`GET /user`

### 4. Get user by email (Protected route)

`GET /user/:email`

**Descripción:** Obtiene la información del usuario por email.

**Headers:**

Debe incluir el token JWT en Authorization.

```json
Authorization: Bearer <jwt_token>
```

**Response:**

```json
{
  "id": "uuid",
  "email": "user@example.com"
}
```

## ⚙️ Installation

### 1. Clone the repo:

```bash
git clone https://github.com/AgricultureOperations/auth-service.git
```

### 2. Install dependencies:

```bash
npm install
```

### 3. Create .env file with:

```bash
PORT=your_port_here
JWT_SECRET=your_secret_key
```

### 4. Run the development server:

```bash
npm run dev
```

## 🧪 Running Tests

### 1. Create .env.test file with:

```bash
PORT=your_port_here
JWT_SECRET=your_secret_key
```

### 2. Run all tests:

```bash
npm run test
```

---

## 🐳 Running with Docker

The service can be built and executed as a Docker container.

### Build the image

```bash
docker build -t auth-service .
```

### Run the container

```bash
docker run --env-file .env -d -p 3000:3000 auth-service
```

The API will be available at:
```bash
http://localhost:3000
```

---

## 🧠 Design Decisions

- ✅ TypeScript strict mode enabled  

- 🧱 Clean separation of concerns  

- 🔐 JWT-based stateless authentication  

- 🔑 Password hashing using bcrypt  

- 🌐 HTTP status codes properly implemented  

- 📦 CommonJS module system  

- Layeres architecture

- Microservice-ready architecture

- Docker-ready deploynent

## 🔮 Future Improvements

- 🛑 Global error handling middleware  

- ✅ Input validation (Joi / Zod / express-validator)  

- 📘 Swagger API documentation 

- 🚀 CI/CD pipeline (GitHub Actions) 

## 📌 Author

**Edward Cruz**  
Backend Developer | Node.js | TypeScript | REST APIs