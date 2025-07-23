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

// CORS configuração específica para Render
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

// Endpoint de teste do Puppeteer
app.get('/test-puppeteer', async (req, res) => {
    let browser;
    try {
        console.log('🧪 Testando inicialização do Puppeteer...');
        
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });
        
        const page = await browser.newPage();
        await page.goto('https://www.google.com', { timeout: 10000 });
        const title = await page.title();
        
        console.log('✅ Puppeteer funcionando!');
        
        res.json({
            status: 'success',
            message: 'Puppeteer funcionando corretamente',
            pageTitle: title
        });
        
    } catch (error) {
        console.error('❌ Erro no Puppeteer:', error);
        res.status(500).json({
            status: 'error',
            message: 'Puppeteer falhou',
            error: error.message
        });
    } finally {
        if (browser) await browser.close();
    }
});

// Endpoint principal com seletores melhorados
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
    const cacheKey = `v2-${termoBusca}-${regiao}-${maxResults}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return res.json({ 
            ...cached, 
            fromCache: true,
            message: "Dados do cache" 
        });
    }

    let browser;
    try {
        console.log(`🚀 Iniciando scraping para: "${termoBusca}" ${regiao ? `em ${regiao}` : ''}`);
        
        // Configuração específica para Render
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        // Busca com região se fornecida
        const searchTerm = regiao ? `${termoBusca} ${regiao}` : termoBusca;
        const searchURL = `https://www.google.com/maps/search/${encodeURIComponent(searchTerm)}`;
        console.log(`📍 Acessando: ${searchURL}`);
        
        await page.goto(searchURL, { waitUntil: "networkidle0", timeout: 20000 });
        console.log('⏱️ Página carregada, aguardando resultados...');
        
        // Aguardar mais tempo para carregar
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Scroll para carregar mais resultados
        await page.evaluate(async () => {
            const scrollContainer = document.querySelector('[role="main"]') || document.body;
            for (let i = 0; i < 3; i++) {
                scrollContainer.scrollBy(0, 1000);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        });

        console.log('🔍 Procurando por links de estabelecimentos...');

        // Buscar links com múltiplos seletores
        const links = await page.evaluate(() => {
            // Múltiplos seletores para diferentes versões do Google Maps
            const selectors = [
                'a[href*="/place/"]',
                'a[data-value*="place"]',
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
            
            console.log(`Encontrados ${allLinks.size} links únicos`);
            return Array.from(allLinks).slice(0, 15);
        });

        console.log(`🔗 Total de ${links.length} links encontrados`);

        if (links.length === 0) {
            return res.json({
                resultados: [],
                total: 0,
                termo: termoBusca,
                regiao: regiao || 'Todas as regiões',
                message: 'Nenhum estabelecimento encontrado. Tente termos mais específicos.',
                debug: {
                    searchURL,
                    timestamp: new Date().toISOString()
                }
            });
        }

        // Processar links um por vez
        const results = [];
        const linksToProcess = links.slice(0, Math.min(maxResults, 8));

        for (let i = 0; i < linksToProcess.length; i++) {
            const link = linksToProcess[i];
            console.log(`📝 Processando ${i + 1}/${linksToProcess.length}: ${link.substring(0, 80)}...`);
            
            try {
                const subPage = await browser.newPage();
                await subPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
                await subPage.goto(link, { waitUntil: "domcontentloaded", timeout: 15000 });
                await new Promise(resolve => setTimeout(resolve, 3000));

                const dados = await subPage.evaluate((options) => {
                    // Função para obter nome com múltiplos seletores
                    const getNome = () => {
                        const selectors = [
                            'h1.DUwDvf',
                            'h1[data-attrid="title"]',
                            '.x3AX1-LfntMc-header-title-title',
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

                    // Função para obter endereço
                    const getEndereco = () => {
                        const selectors = [
                            'button[data-item-id="address"] .W4Efsd',
                            '[data-item-id="address"] .W4Efsd',
                            '.Io6YTe',
                            '.T6pBCe',
                            '.rogA2c .Io6YTe'
                        ];
                        
                        for (const selector of selectors) {
                            const element = document.querySelector(selector);
                            if (element && element.textContent.trim()) {
                                return element.textContent.trim();
                            }
                        }
                        return null;
                    };

                    // Função para obter telefone
                    const getTelefone = () => {
                        const selectors = [
                            'button[data-item-id="phone"] .W4Efsd',
                            '[data-item-id="phone"] .W4Efsd',
                            'button[data-tooltip*="telefone"]',
                            '.rogA2c button[data-item-id="phone"]'
                        ];
                        
                        for (const selector of selectors) {
                            const element = document.querySelector(selector);
                            if (element && element.textContent.trim()) {
                                return element.textContent.trim();
                            }
                        }
                        return null;
                    };

                    // Função para obter avaliação
                    const getAvaliacao = () => {
                        const selectors = [
                            '.MW4etd',
                            '.ceNzKf',
                            'span.yi40Hd.YrbPuc'
                        ];
                        
                        for (const selector of selectors) {
                            const element = document.querySelector(selector);
                            if (element && element.textContent.trim()) {
                                return element.textContent.trim();
                            }
                        }
                        return null;
                    };

                    // Função para obter categoria
                    const getCategoria = () => {
                        const selectors = [
                            '.DkEaL',
                            '.mgr77e .DkEaL',
                            'button[jsaction*="category"]'
                        ];
                        
                        for (const selector of selectors) {
                            const element = document.querySelector(selector);
                            if (element && element.textContent.trim()) {
                                return element.textContent.trim();
                            }
                        }
                        return null;
                    };

                    // Função para obter horários
                    const getHorarios = () => {
                        if (!options.incluirHorarios) return null;
                        
                        const selectors = [
                            '.t39EBf',
                            '.ZDu9vd',
                            '.OqCZI .t39EBf'
                        ];
                        
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
                        categoria: getCategoria(),
                        horarios: getHorarios()
                    };
                }, { incluirHorarios, incluirReviews });

                // Filtrar por avaliação se especificado
                const rating = parseFloat(dados.avaliacao);
                if (minRating > 0 && (!isNaN(rating) && rating < minRating)) {
                    console.log(`⏭️ Item ignorado (avaliação ${dados.avaliacao} < ${minRating}): ${dados.nome}`);
                    await subPage.close();
                    continue;
                }

                const resultado = {
                    nome: dados.nome || "Nome não encontrado",
                    endereco: dados.endereco || "Endereço não encontrado",
                    telefone: dados.telefone || "Telefone não encontrado",
                    avaliacao: dados.avaliacao || "Sem avaliação",
                    categoria: dados.categoria || "Categoria não encontrada",
                    horarios: dados.horarios || "Horários não encontrados",
                    reviews: [],
                    link: link
                };

                results.push(resultado);
                await subPage.close();
                console.log(`✅ Item ${i + 1} processado: ${dados.nome || 'Sem nome'}`);
                
            } catch (error) {
                console.error(`❌ Erro no item ${i + 1}:`, error.message);
            }

            // Pausa entre itens para não sobrecarregar
            await new Promise(resolve => setTimeout(resolve, 2000));
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
            details: error.message,
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
    console.log(`🧪 Teste Puppeteer: http://localhost:${PORT}/test-puppeteer`);
    console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});