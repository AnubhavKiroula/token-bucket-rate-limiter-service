# Token Bucket Rate Limiter Service

A standalone, production-ready backend service implementing a highly performant and scalable Token Bucket Rate Limiting algorithm. The service features persistence, multi-instance safety (distributed environments), comprehensive testing (unit & integration), and load testing configurations.

---

## 🛠️ Tech Stack

- **Runtime Environment**: Node.js (v22.x)
- **Programming Language**: TypeScript
- **Web Framework**: Express
- **Persistence Store**: Redis (using atomic Lua scripts)
- **Logging / Observability**: Structured JSON logging (Morgan for development HTTP, JSON format for runtime events)
- **Testing Framework**: Jest & Supertest
- **Containerization**: Docker & Docker Compose

---

## 🗺️ Phase Roadmap

- [x] **Phase 1: Repository & Base Structure Initialization**
  - Initialize Node.js, TypeScript, Express, Jest configuration.
  - Implement health check endpoint with logger.
  - Setup CI/CD build & test verification workflows.
- [x] **Phase 2: Core Rate Limiting Implementation**
  - Implement in-memory token bucket rate limiter.
  - Add API endpoints and middleware to apply limits to request paths.
- [x] **Phase 3: Persistence and Distributed Safety**
  - Integrate Redis for multi-instance distributed token bucket synchronization.
  - Ensure thread/concurrency safety (atomic Redis operations via Lua scripting).
  - Implement Basic-Auth-secured `/admin/config` endpoint to persist client-specific overrides.
- [ ] **Phase 4: Load Testing & Performance Optimization**
  - Configure load testing tools (e.g., Artillery, autocannon).
  - Benchmark performance and optimize throughput.

---

## 🚀 Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) (v20+ recommended), npm, and [Docker](https://www.docker.com/) installed.

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/token-bucket-rate-limiter-service.git
   cd token-bucket-rate-limiter-service
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Running the App
- **Development Mode** (requires a local Redis running on port `6379`, with hot reloading via `ts-node-dev`):
  ```bash
  npm run dev
  ```
- **Production Build** (compiles TypeScript):
  ```bash
  npm run build
  ```
  Run the compiled service locally:
  ```bash
  npm start
  ```
- **Docker Multi-Instance Mode** (spins up Redis + `service-1` on port `3000` + `service-2` on port `3001` in a bridge network):
  ```bash
  docker-compose up --build
  ```

---

## 🔌 API Documentation

### 1. Check Rate Limit
Query rate-limiting decisions for any client key.

* **Endpoint**: `/check`
* **Method**: `GET` or `POST`
* **Headers**:
  * `X-Client-Key` (Optional): Unique string representing the client. If not supplied, falls back to IP address.
  * `X-Client-Capacity` (Optional): Override capacity (burst size).
  * `X-Client-Refill-Rate` (Optional): Override refill rate (tokens/sec).

* **Query Parameters**:
  * `key` or `clientKey` (Optional): Alternative way to provide client key.
  * `capacity` (Optional): Alternative way to provide custom capacity.
  * `refillRate` (Optional): Alternative way to provide custom refill rate.

#### Response Headers
* `X-RateLimit-Limit`: The configured maximum capacity.
* `X-RateLimit-Remaining`: Floor value of remaining tokens.
* `X-RateLimit-Reset`: Unix Epoch seconds when the bucket will be completely full again.

#### Response Bodies

##### Decision: ALLOW (HTTP 200 OK)
```json
{
  "decision": "ALLOW",
  "key": "client_1",
  "tokensRemaining": 9,
  "capacity": 10,
  "refillRate": 10,
  "resetTime": 1719438992
}
```

##### Decision: DENY (HTTP 200 OK)
```json
{
  "decision": "DENY",
  "key": "client_1",
  "tokensRemaining": 0,
  "capacity": 10,
  "refillRate": 10,
  "resetTime": 1719439002
}
```

#### Curl Examples
* **Basic Check** (Uses default 10 tokens/sec, burst 10):
  ```bash
  curl -i "http://localhost:3000/check?key=client_1"
  ```
* **Custom Limit Overrides** (Set capacity to 5, refill rate to 2 tokens/sec):
  ```bash
  curl -i "http://localhost:3000/check?key=vip_client&capacity=5&refillRate=2"
  ```
* **Post Request with JSON Body**:
  ```bash
  curl -i -X POST http://localhost:3000/check \
    -H "Content-Type: application/json" \
    -d '{"key": "app_user", "capacity": 20, "refillRate": 5}'
  ```

---

### 2. Configure Client Limits (Admin Only)
Set custom capacity and refill rate configurations for a client, persisted in Redis.

* **Endpoint**: `/admin/config`
* **Method**: `POST`
* **Authentication**: HTTP Basic Auth (Credentials: `ADMIN_USERNAME` / `ADMIN_PASSWORD`, default: `admin` / `secret123`)
* **Headers**:
  * `Authorization`: `Basic <base64-credentials>`
  * `Content-Type`: `application/json`

* **Request Body**:
  ```json
  {
    "key": "vip_user",
    "capacity": 20,
    "refillRate": 5
  }
  ```

* **Response Body (HTTP 200 OK)**:
  ```json
  {
    "success": true,
    "message": "Successfully configured rate limits for client: vip_user",
    "config": {
      "key": "vip_user",
      "capacity": 20,
      "refillRate": 5
    }
  }
  ```

#### Curl Example
```bash
curl -i -X POST -u admin:secret123 \
  -H "Content-Type: application/json" \
  -d '{"key": "vip_user", "capacity": 20, "refillRate": 5}' \
  http://localhost:3000/admin/config
```

---

## 👥 Multi-Instance Coordination Demo

When running the application using Docker Compose, the rate limiting state is fully shared and atomic across multiple server instances thanks to our Redis backend and Lua scripting.

You can verify this shared distributed rate limiting state across `service-1` (port `3000`) and `service-2` (port `3001`):

1. **Configure a client** with small limits via `service-1`:
   ```bash
   curl -X POST -u admin:secret123 \
     -H "Content-Type: application/json" \
     -d '{"key": "demo-client", "capacity": 3, "refillRate": 0.1}' \
     http://localhost:3000/admin/config
   ```

2. **Consume a token** from `service-1`:
   ```bash
   curl -i "http://localhost:3000/check?key=demo-client"
   ```
   *Expected Response Header*: `X-RateLimit-Remaining: 2` (3 capacity minus 1 consumed).

3. **Consume another token** from `service-2` (representing a load-balanced target):
   ```bash
   curl -i "http://localhost:3001/check?key=demo-client"
   ```
   *Expected Response Header*: `X-RateLimit-Remaining: 1` (Shared state reflects the previous consumption).

4. **Exhaust the remaining tokens** from `service-1`:
   ```bash
   curl -i "http://localhost:3000/check?key=demo-client"
   ```
   *Expected Response Header*: `X-RateLimit-Remaining: 0`.

5. **Trigger rate-limiting rejection** from `service-2`:
   ```bash
   curl -i "http://localhost:3001/check?key=demo-client"
   ```
   *Expected Response*: `HTTP/1.1 200 OK` with JSON decision: `"DENY"`.

---

## 🧪 Testing

We use Jest along with Supertest for running unit and mock integration tests on the Express app.

To execute the test suite, run:
```bash
npm test
```
