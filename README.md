# Stop Online

## Índice

1. [Visão geral](#1-visão-geral)
2. [Conceitos distribuídos usados](#2-conceitos-distribuídos-usados)
3. [Arquitetura](#3-arquitetura)
4. [Como executar](#4-como-executar)
5. [Como jogar](#5-como-jogar)
6. [Principais endpoints](#6-principais-endpoints)
7. [Roteiro para apresentação](#7-roteiro-para-apresentação)

## 1. Visão geral

✅ Confirmado no código: este projeto implementa o jogo **Stop** usando servidor em Python com **FastAPI** e cliente em **HTML, CSS e JavaScript**.

O servidor mantém o estado global da partida, as regras de rodada, as respostas, os votos e a pontuação. O cliente é responsável pela interface e pela interação dos jogadores.

## 2. Conceitos distribuídos usados

| Conceito | Uso no projeto |
| --- | --- |
| API REST com FastAPI | Criação de salas, entrada de jogadores, configuração do lobby, respostas, STOP, votação e finalização da rodada. |
| Cache distribuído com Redis | Armazena o estado global das salas em chaves `stop:room:{id}`. |
| Mensageria com RabbitMQ | Publica eventos da aplicação, como `room.created`, `room.round_started`, `room.stopped` e `room.round_finished`. |
| WebSocket | Atualiza todos os jogadores da sala em tempo real quando o estado muda. |

### Cache-Aside / DSM

O projeto usa Redis como camada distribuida para compartilhar o estado das salas entre chamadas da API. A fronteira dessa arquitetura fica em `app/redis_store.py`, mantendo `app/game.py` focado nas regras do Stop.

Fluxo de leitura:

1. `GameService` pede a sala para `RedisStore`.
2. `RedisStore` tenta ler primeiro a chave `{CACHE_PREFIX}:room:{roomId}` no Redis.
3. Em hit, a sala volta imediatamente para a aplicacao.
4. Em miss, o store consulta a origem local resiliente em memoria.
5. Apos uma leitura bem-sucedida da origem, o Redis e preenchido novamente com `CACHE_TTL`.
6. Se o Redis estiver indisponivel, a API continua funcionando com fallback em memoria quando `CACHE_FALLBACK_ENABLED=true`.

Variaveis suportadas:

| Variavel | Padrao | Uso |
| --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6379/0` | Conexao com Redis. |
| `CACHE_ENABLED` | `true` | Liga/desliga a camada Redis. |
| `CACHE_TTL` | `3600` | Tempo de vida das salas no cache, em segundos. |
| `CACHE_PREFIX` | `stop` | Prefixo das chaves no Redis. |
| `CACHE_FALLBACK_ENABLED` | `true` | Mantem fallback local em caso de miss/falha. |
| `DSM_PANEL_ENABLED` | `true` | Habilita endpoints do painel dev/ops. |
| `DSM_DEBUG_TOKEN` | vazio | Quando definido, exige header `X-Dsm-Token`. |

Painel dev/ops:

- Acesse `http://127.0.0.1:8001/?debug=1`.
- O painel mostra status DSM, status Redis, latencia, hit/miss/erro, ultimas operacoes e horario da ultima atualizacao.
- `Atualizar` recarrega o diagnostico.
- `Forcar miss` faz a proxima leitura da sala ignorar o Redis e buscar a origem.
- `Limpar cache` remove a chave Redis da sala atual.

## 3. Arquitetura

```mermaid
flowchart LR
    Jogador[Jogador no navegador] --> Cliente[HTML CSS JS]
    Cliente -->|REST /api/v1| API[FastAPI]
    Cliente <-->|WebSocket /ws/rooms/{id}| API
    API -->|estado da sala| Redis[(Redis)]
    API -->|eventos de dominio| RabbitMQ[(RabbitMQ)]
```

✅ Confirmado no código: a separação entre cliente e servidor está nos diretórios `app/static` e `app`.

- `app/main.py`: endpoints REST, WebSocket e integração geral.
- `app/game.py`: regras do Stop.
- `app/redis_store.py`: persistência do estado no Redis.
- `app/rabbitmq.py`: publicação de eventos no RabbitMQ.
- `app/static`: interface HTML/CSS/JS.

## 4. Como executar

Use este fluxo no Windows/PowerShell para evitar os problemas mais comuns: Docker Desktop parado, porta `8000` ocupada e comando `uvicorn` fora do PATH.

1. Abra o **Docker Desktop** e espere o engine iniciar.

Valide no terminal:

```powershell
docker ps
```

Se aparecer erro com `dockerDesktopLinuxEngine`, o Docker Desktop ainda não iniciou corretamente.

2. Entre na pasta do projeto:

```powershell
cd C:\Users\User\Downloads\github\StopTime
```

3. Suba Redis e RabbitMQ:

```powershell
docker compose up -d
```

4. Confirme se os containers estão rodando:

```powershell
docker compose ps
```

O esperado é ver `stop-redis` e `stop-rabbitmq` com status `Up`.

5. Instale as dependências:

```powershell
python -m pip install -r requirements.txt
```

6. Execute a aplicação na porta recomendada:

```powershell
python -m uvicorn app.main:app --reload --port 8001
```

7. Acesse:

- Aplicação: [http://127.0.0.1:8001](http://127.0.0.1:8001)
- Aplicação com painel DSM/cache: [http://127.0.0.1:8001/?debug=1](http://127.0.0.1:8001/?debug=1)
- Swagger da API: [http://127.0.0.1:8001/docs](http://127.0.0.1:8001/docs)
- RabbitMQ Management: [http://localhost:15672](http://localhost:15672), usuário `guest`, senha `guest`

Se a porta `8001` estiver ocupada, use outra:

```powershell
python -m uvicorn app.main:app --reload --port 8002
```

Para descobrir quem está usando uma porta:

```powershell
netstat -ano | findstr :8001
```

Se for um processo Python antigo da própria API, encerre pelo PID:

```powershell
Stop-Process -Id NUMERO_DO_PID
```

## 5. Como jogar

1. Um jogador informa o nome e cria a sala.
2. No lobby, os jogadores podem alterar categorias e letras sorteáveis.
3. Outro jogador entra usando o código da sala.
4. Um jogador clica em **Começar rodada**.
5. A sala mostra a letra sorteada, as caixas de resposta e um timer de 3 minutos.
6. Quem terminar clica em **STOP!**, ou a rodada termina automaticamente quando o tempo acaba.
7. Um pop-up grande de **STOP!** aparece para todos, forçando a parada.
8. A conferência mostra uma categoria por vez com as respostas de cada participante.
9. Na votação, os participantes validam ou invalidam as respostas dos colegas.
10. Ao finalizar a rodada, o servidor calcula:

| Regra | Pontuação |
| --- | --- |
| Palavra válida e única | 10 pontos |
| Palavra válida repetida | 5 pontos |
| Palavra inválida, em branco ou com letra errada | 0 pontos |

Depois da pontuação, o sistema mostra o pódio da rodada. O botão **Nova rodada** retorna para a etapa de preenchimento com uma nova letra. A sala segue assim até algum jogador atingir **100 pontos**, quando o vencedor é exibido e novas rodadas são bloqueadas.

## 6. Principais endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/api/v1/rooms` | Cria sala. |
| `GET` | `/api/v1/rooms/{roomId}` | Consulta estado da sala. |
| `POST` | `/api/v1/rooms/{roomId}/players` | Entra em uma sala. |
| `PATCH` | `/api/v1/rooms/{roomId}` | Atualiza categorias e letras no lobby. |
| `POST` | `/api/v1/rooms/{roomId}/rounds` | Inicia rodada e sorteia letra. |
| `POST` | `/api/v1/rooms/{roomId}/answers` | Salva respostas do jogador. |
| `POST` | `/api/v1/rooms/{roomId}/stop` | Encerra a rodada e abre votação. |
| `POST` | `/api/v1/rooms/{roomId}/votes` | Registra voto de validação. |
| `POST` | `/api/v1/rooms/{roomId}/finish` | Calcula pontuação da rodada. |
| `WS` | `/ws/rooms/{roomId}` | Atualizações em tempo real. |

## 7. Roteiro para apresentação

1. Explicar a arquitetura: navegador, FastAPI, Redis, RabbitMQ e WebSocket.
2. Mostrar o Swagger e os endpoints REST.
3. Abrir dois navegadores, criar sala e entrar com outro jogador.
4. Alterar categorias/letras no lobby para demonstrar regra configurável.
5. Iniciar rodada, preencher respostas, clicar em STOP e votar.
6. Finalizar rodada e mostrar a pontuação.
7. Abrir RabbitMQ Management e mostrar a fila `stop.events.audit`.
8. Explicar concorrência simples: o servidor centraliza o estado no Redis e propaga alterações via WebSocket.
## 8. Checklist de validacao da demo

Antes da apresentacao, rode este fluxo completo:

1. Inicie Redis e RabbitMQ:

```bash
docker compose up -d
```

2. Inicie a API:

```bash
python -m uvicorn app.main:app --reload --port 8001
```

3. Abra o jogo em duas janelas ou navegadores:

- [http://127.0.0.1:8001](http://127.0.0.1:8001)
- [http://127.0.0.1:8001/?debug=1](http://127.0.0.1:8001/?debug=1)

4. Crie uma sala no primeiro navegador.
5. Entre na mesma sala pelo segundo navegador.
6. Inicie a rodada e teste dois cenarios:
   - clicar em **STOP!** com todos os campos preenchidos;
   - deixar o tempo acabar com campos incompletos para validar o encerramento automatico.
7. Vote nas respostas e finalize a rodada.
8. No painel DSM, teste:
   - **Atualizar**;
   - **Forcar miss**;
   - **Limpar cache**.
9. Abra o RabbitMQ Management:

- [http://localhost:15672](http://localhost:15672)
- usuario: `guest`
- senha: `guest`

10. Verifique a fila `stop.events.audit` e observe no terminal da API os logs `Evento processado assincronamente`.
