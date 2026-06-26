# Token Bucket Rate Limiter Service

A standalone, production-ready backend service implementing a highly performant and scalable Token Bucket Rate Limiting algorithm. The service features persistence, multi-instance safety (distributed environments), comprehensive testing (unit & integration), and load testing configurations.

---

## 🛠️ Tech Stack

- **Runtime Environment**: Node.js (v22.x)
- **Programming Language**: TypeScript
- **Web Framework**: Express
- **Logging / Observability**: Morgan
- **Testing Framework**: Jest & Supertest
- **Containerization**: Docker (planned for future phases)

---

## 🗺️ Phase Roadmap

- [x] **Phase 1: Repository & Base Structure Initialization**
  - Initialize Node.js, TypeScript, Express, Jest configuration.
  - Implement health check endpoint with logger.
  - Setup CI/CD build & test verification workflows.
- [ ] **Phase 2: Core Rate Limiting Implementation**
  - Implement in-memory token bucket rate limiter.
  - Add API endpoints and middleware to apply limits to request paths.
- [ ] **Phase 3: Persistence and Distributed Safety**
  - Integrate Redis for multi-instance distributed token bucket synchronization.
  - Ensure thread/concurrency safety (atomic Redis operations).
- [ ] **Phase 4: Load Testing & Performance Optimization**
  - Configure load testing tools (e.g., Artillery, autocannon).
  - Benchmark performance and optimize throughput.

---

## 🚀 Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) (v20+ recommended) and npm installed.

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
- **Development Mode** (with hot reloading via `ts-node-dev`):
  ```bash
  npm run dev
  ```
- **Production Build**:
  Compile TypeScript to JS:
  ```bash
  npm run build
  ```
  Run the compiled service:
  ```bash
  npm start
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

## 🧪 Testing

We use Jest along with Supertest for running integration tests on the Express app.

To execute the test suite, run:
```bash
npm test
```

