import express from "express";
import cors from "cors";
import puppeteer from "puppeteer-core";
import NodeCache from "node-cache";
import path from "path";
import { fileURLToPath } from "url";
import chromium from "@sparticuz/chromium";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Cache inteligente - 1 hora
const cache = new NodeCache({ stdTTL: 3600 });

// CORS configuração
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://uaifunnel.github.io',
    'https://gmaps-scraper-api.onrender.com'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.options('*', cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Endpoints de teste
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Google Maps Scraper API funcionando no Render',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        environment: process.env.NODE_ENV || 'development',
        memory: process.memoryUsage(),
        uptime: process.uptime()
    });
});

// ✅ FUNÇÃO DE NAVEGAÇÃO COM RETRY
async function navigateWithRetry(page, url, maxRetries = 2) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔄 Tentativa ${attempt}/${maxRetries} para carregar página`);
            
            await page.goto(url, { 
                waitUntil: "domcontentloaded", 
                timeout: 40000 // Timeout maior
            });
            
            // Verificar se a página carregou
            await page.waitForSelector('body', { timeout: 5000 });
            console.log(`✅ Página carregada na tentativa ${attempt}`);
            return true;
            
        } catch (error) {
            console.log(`❌ Tentativa ${attempt} falhou: ${error.message.substring(0, 100)}`);
            
            if (attempt === maxRetries) {
                throw new Error(`Falha após ${maxRetries} tentativas: ${error.message}`);
            }
            
            // Aguardar antes da próxima tentativa
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
}

// Endpoint principal otimizado
app.post("/scrape-advanced", async (req, res) => {
    const { 
        termoBusca, 
        maxResults = 5,
        regiao = '',
        minRating = 0,
        incluirHorarios = false,
        incluirReviews = false
    } = req.body;
    
    if (!termoBusca) {
        return res.status(400).json({ error: "Termo de busca não fornecido." });
    }

    // Verificar cache primeiro
    const cacheKey = `v3-${termoBusca}-${regiao}-${maxResults}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return res.json({ 
            ...cached, 
            fromCache: true,
            message: "Dados do cache - resposta instantânea!" 
        });
    }

    let browser;
    try {
        console.log(`🚀 Iniciando scraping para: "${termoBusca}" ${regiao ? `em ${regiao}` : ''}`);
        
        // Configuração otimizada para Render
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await browser.newPage();
        
        // ✅ OTIMIZAÇÕES DE PERFORMANCE
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        // Bloquear recursos desnecessários
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Timeouts otimizados
        await page.setDefaultTimeout(25000);
        await page.setDefaultNavigationTimeout(45000);

        // Busca com região se fornecida
        const searchTerm = regiao ? `${termoBusca} ${regiao}` : termoBusca;
        const searchURL = `https://www.google.com/maps/search/${encodeURIComponent(searchTerm)}`;
        console.log(`📍 Acessando: ${searchURL}`);
        
        // ✅ USAR NAVEGAÇÃO COM RETRY
        await navigateWithRetry(page, searchURL);
        
        console.log('⏱️ Aguardando resultados aparecerem...');
        await new Promise(resolve => setTimeout(resolve, 4000));

        // Aguardar especificamente pelos elementos de resultado
        try {
            await page.waitForSelector('a[href*="/place/"], .hfpxzc', { timeout: 15000 });
            console.log('✅ Elementos de resultado encontrados');
        } catch (error) {
            console.log('⚠️ Elementos não encontrados no tempo esperado, continuando...');
        }

        // Scroll suave para carregar mais resultados
        await page.evaluate(async () => {
            const scrollContainer = document.querySelector('[role="main"]') || document.body;
            for (let i = 0; i < 2; i++) {
                scrollContainer.scrollBy(0, 800);
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        });

        console.log('🔍 Procurando por links de estabelecimentos...');

        // Buscar links com seletores múltiplos
        const links = await page.evaluate(() => {
            const selectors = [
                'a[href*="/place/"]',
                '.hfpxzc',
                '[data-result-index] a',
                '.Nv2PK a'
            ];
            
            let allLinks = new Set();
            
            selectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    if (el.href && el.href.includes('/place/')) {
                        allLinks.add(el.href);
                    }
                });
            });
            
            return Array.from(allLinks).slice(0, 12);
        });

        console.log(`🔗 Total de ${links.length} links encontrados`);

        if (links.length === 0) {
            return res.json({
                resultados: [],
                total: 0,
                termo: termoBusca,
                regiao: regiao || 'Todas as regiões',
                message: 'Nenhum estabelecimento encontrado. A página pode ter demorado muito para carregar.',
                debug: {
                    searchURL,
                    timestamp: new Date().toISOString()
                }
            });
        }

        // Processar links com timeout individual
        const results = [];
        const linksToProcess = links.slice(0, Math.min(maxResults, 6)); // Reduzir para 6

        for (let i = 0; i < linksToProcess.length; i++) {
            const link = linksToProcess[i];
            console.log(`📝 Processando ${i + 1}/${linksToProcess.length}`);
            
            try {
                const subPage = await browser.newPage();
                await subPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
                
                // ✅ TIMEOUT MENOR PARA PÁGINAS INDIVIDUAIS
                await subPage.goto(link, { 
                    waitUntil: "domcontentloaded", 
                    timeout: 20000 // Timeout menor para páginas individuais
                });
                
                await new Promise(resolve => setTimeout(resolve, 2500));

                const dados = await subPage.evaluate(() => {
                    const getNome = () => {
                        const selectors = [
                            'h1.DUwDvf',
                            'h1[data-attrid="title"]',
                            '.SPZz6b h1',
                            'h1',
                            '.qrShPb h1'
                        ];
                        
                        for (const selector of selectors) {
                            const element = document.querySelector(selector);
                            if (element && element.textContent.trim()) {
                                return element.textContent.trim();
                            }
                        }
                        return null;
                    };

                    const getEndereco = () => {
                        const selectors = [
                            'button[data-item-id="address"] .W4Efsd',
                            '[data-item-id="address"] .W4Efsd',
                            '.Io6YTe',
                            '.T6pBCe'
                        ];
                        
                        for (const selector of selectors) {
                            const element = document.querySelector(selector);
                            if (element && element.textContent.trim()) {
                                return element.textContent.trim();
                            }
                        }
                        return null;
                    };

                    const getTelefone = () => {
                        const selectors = [
                            'button[data-item-id="phone"] .W4Efsd',
                            '[data-item-id="phone"] .W4Efsd'
                        ];
                        
                        for (const selector of selectors) {
                            const element = document.querySelector(selector);
                            if (element && element.textContent.trim()) {
                                return element.textContent.trim();
                            }
                        }
                        return null;
                    };

                    const getAvaliacao = () => {
                        const selectors = ['.MW4etd', '.ceNzKf'];
                        for (const selector of selectors) {
                            const element = document.querySelector(selector);
                            if (element && element.textContent.trim()) {
                                return element.textContent.trim();
                            }
                        }
                        return null;
                    };

                    const getCategoria = () => {
                        const selectors = ['.DkEaL'];
                        for (const selector of selectors) {
                            const element = document.querySelector(selector);
                            if (element && element.textContent.trim()) {
                                return element.textContent.trim();
                            }
                        }
                        return null;
                    };

                    return {
                        nome: getNome(),
                        endereco: getEndereco(),
                        telefone: getTelefone(),
                        avaliacao: getAvaliacao(),
                        categoria: getCategoria()
                    };
                });

                const resultado = {
                    nome: dados.nome || "Nome não encontrado",
                    endereco: dados.endereco || "Endereço não encontrado",
                    telefone: dados.telefone || "Telefone não encontrado",
                    avaliacao: dados.avaliacao || "Sem avaliação",
                    categoria: dados.categoria || "Categoria não encontrada",
                    horarios: "Não implementado",
                    reviews: [],
                    link: link
                };

                results.push(resultado);
                await subPage.close();
                console.log(`✅ Item ${i + 1} processado: ${dados.nome || 'Sem nome'}`);
                
            } catch (error) {
                console.error(`❌ Erro no item ${i + 1}:`, error.message.substring(0, 80));
            }

            // Pausa entre itens
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        const responseData = {
            resultados: results,
            total: results.length,
            termo: termoBusca,
            regiao: regiao || 'Todas as regiões',
            filtros: { minRating, incluirHorarios, incluirReviews },
            timestamp: new Date().toISOString()
        };

        // Salvar no cache
        cache.set(cacheKey, responseData);

        console.log(`✅ Scraping concluído: ${results.length} resultados encontrados`);
        res.json(responseData);

    } catch (error) {
        console.error(`❌ Erro geral:`, error);
        res.status(500).json({ 
            error: "Erro ao processar requisição",
            details: error.message.substring(0, 200),
            timestamp: new Date().toISOString()
        });
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 Browser fechado');
        }
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📱 Health check: http://localhost:${PORT}/health`);
    console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});