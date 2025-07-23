// import express from "express";
// import cors from "cors";
// import puppeteer from "puppeteer-extra";
// import StealthPlugin from "puppeteer-extra-plugin-stealth";
// import NodeCache from "node-cache";
// import path from "path";
// import { fileURLToPath } from "url";
// import chromium from "@sparticuz/chromium";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// puppeteer.use(StealthPlugin());

// const app = express();
// const PORT = process.env.PORT || 3000;

// // Cache inteligente - 1 hora
// const cache = new NodeCache({ stdTTL: 3600 });

// // ✅ CONFIGURAÇÃO CORS CORRIGIDA
// app.use(cors({
//   origin: [
//     'http://localhost:3000',
//     'https://uaifunnel.github.io',
//     'https://gmaps-scraper-api.onrender.com'
//   ],
//   credentials: true,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
// }));

// // Handler específico para preflight requests
// app.options('*', cors());

// app.use(express.json());
// app.use(express.static(path.join(__dirname, 'frontend')));

// // ✅ ENDPOINTS DE TESTE ADICIONADOS
// app.get('/', (req, res) => {
//     res.json({ 
//         status: 'OK', 
//         message: 'Google Maps Scraper API funcionando',
//         timestamp: new Date().toISOString()
//     });
// });

// app.get('/health', (req, res) => {
//     res.json({ 
//         status: 'healthy',
//         environment: process.env.NODE_ENV || 'development'
//     });
// });

// // Endpoint avançado com filtros
// app.post("/scrape-advanced", async (req, res) => {
//     const { 
//         termoBusca, 
//         maxResults = 20,
//         minRating = 0,           
//         regiao = '',             
//         incluirHorarios = false, 
//         incluirReviews = false   
//     } = req.body;
    
//     if (!termoBusca) {
//         return res.status(400).json({ error: "Termo de busca não fornecido." });
//     }

//     // Verificar cache
//     const cacheKey = `${termoBusca}-${regiao}-${minRating}-${maxResults}`;
//     const cached = cache.get(cacheKey);
//     if (cached) {
//         return res.json({ 
//             ...cached, 
//             fromCache: true,
//             message: "Dados do cache - resposta instantânea!" 
//         });
//     }

//     let browser;
//     try {
//         // ✅ TRATAMENTO DE ERROS MELHORADO
//         const isProduction = process.env.NODE_ENV === 'production';
        
//         console.log(`🚀 Iniciando Puppeteer em modo: ${isProduction ? 'production' : 'development'}`);
        
//         browser = await puppeteer.launch({
//             args: [
//                 '--no-sandbox',
//                 '--disable-setuid-sandbox',
//                 '--disable-dev-shm-usage',
//                 '--disable-accelerated-2d-canvas',
//                 '--disable-gpu',
//                 '--disable-web-security',
//                 '--disable-features=VizDisplayCompositor',
//                 '--single-process',
//                 '--no-zygote',
//                 '--disable-background-timer-throttling',
//                 '--disable-backgrounding-occluded-windows',
//                 '--disable-renderer-backgrounding'
//             ],
//             headless: true,
//             ignoreHTTPSErrors: true,
//             executablePath: isProduction ? 
//                 await chromium.executablePath() : 
//                 puppeteer.executablePath(),
//         });
        
//         console.log(`✅ Puppeteer iniciado com sucesso`);

//         const page = await browser.newPage();
//         await page.setViewport({ width: 1920, height: 1080 });
//         await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
//         await page.setExtraHTTPHeaders({
//             'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
//         });

//         // Busca com região
//         const searchTerm = regiao ? `${termoBusca} ${regiao}` : termoBusca;
//         const searchURL = `https://www.google.com/maps/search/${encodeURIComponent(searchTerm)}`;
        
//         await page.goto(searchURL, { waitUntil: "domcontentloaded", timeout: 30000 });
//         await new Promise(resolve => setTimeout(resolve, 5000));
        
//         // Auto scroll para carregar mais resultados
//         await autoScroll(page);

//         const links = await page.evaluate(() => {
//             const anchors = document.querySelectorAll('a[href*="/place/"]');
//             return Array.from(anchors)
//                 .map(a => a.href)
//                 .filter((href, index, arr) => arr.indexOf(href) === index)
//                 .slice(0, 50);
//         });

//         // Processamento paralelo
//         const results = await processLinksParallel(browser, links.slice(0, maxResults), {
//             minRating,
//             incluirHorarios,
//             incluirReviews
//         });

//         // Filtrar por avaliação
//         const filteredResults = results.filter(item => {
//             const rating = parseFloat(item.avaliacao);
//             return !isNaN(rating) ? rating >= minRating : true;
//         });

//         const responseData = {
//             resultados: filteredResults,
//             total: filteredResults.length,
//             termo: termoBusca,
//             regiao: regiao || 'Todas as regiões',
//             filtros: { minRating, incluirHorarios, incluirReviews }
//         };

//         // Salvar no cache
//         cache.set(cacheKey, responseData);

//         res.json(responseData);

//     } catch (error) {
//         console.error(`❌ Erro ao iniciar Puppeteer:`, error);
//         res.status(500).json({ 
//             error: "Erro interno do servidor - Puppeteer falhou ao inicializar",
//             details: error.message 
//         });
//     } finally {
//         if (browser) await browser.close();
//     }
// });

// // Processamento paralelo de links
// async function processLinksParallel(browser, links, options) {
//     const results = [];
//     const batchSize = 1; // Processar 1 por vez no Render Free
    
//     for (let i = 0; i < links.length; i += batchSize) {
//         const batch = links.slice(i, i + batchSize);
//         const batchPromises = batch.map(link => processLink(browser, link, options));
        
//         const batchResults = await Promise.allSettled(batchPromises);
        
//         batchResults.forEach((result, index) => {
//             if (result.status === 'fulfilled' && result.value) {
//                 results.push(result.value);
//                 console.log(`✅ Lote ${Math.floor(i/batchSize) + 1} - Item ${index + 1} processado`);
//             }
//         });
        
//         // Pausa maior entre lotes para Render
//         await new Promise(resolve => setTimeout(resolve, 3000));
//     }
    
//     return results;
// }

// // Processar link individual
// async function processLink(browser, link, options) {
//     const subPage = await browser.newPage();
    
//     try {
//         // Timeout maior para páginas lentas
//         await subPage.goto(link, { waitUntil: "domcontentloaded", timeout: 25000 });
//         await new Promise(resolve => setTimeout(resolve, 2000));

//         const dados = await subPage.evaluate((opts) => {
//             const getNome = () => {
//                 const selectors = ['h1.DUwDvf', 'h1[data-attrid="title"]', 'h1'];
//                 for (let selector of selectors) {
//                     const el = document.querySelector(selector);
//                     if (el) return el.textContent.trim();
//                 }
//                 return null;
//             };

//             const getEndereco = () => {
//                 const selectors = [
//                     'button[data-item-id="address"] .W4Efsd',
//                     '[data-item-id="address"]',
//                     '.Io6YTe'
//                 ];
//                 for (let selector of selectors) {
//                     const el = document.querySelector(selector);
//                     if (el) return el.textContent.trim();
//                 }
//                 return null;
//             };

//             const getTelefone = () => {
//                 const selectors = [
//                     'button[data-item-id="phone"] .W4Efsd',
//                     '[data-item-id="phone"]'
//                 ];
//                 for (let selector of selectors) {
//                     const el = document.querySelector(selector);
//                     if (el) return el.textContent.trim();
//                 }
//                 return null;
//             };

//             const getAvaliacao = () => {
//                 const el = document.querySelector('.MW4etd');
//                 return el ? el.textContent.trim() : null;
//             };

//             const getCategoria = () => {
//                 const el = document.querySelector('.DkEaL');
//                 return el ? el.textContent.trim() : null;
//             };

//             // Horários de funcionamento
//             const getHorarios = () => {
//                 if (!opts.incluirHorarios) return null;
//                 const horariosEl = document.querySelector('.t39EBf');
//                 return horariosEl ? horariosEl.textContent.trim() : null;
//             };

//             // Reviews
//             const getReviews = () => {
//                 if (!opts.incluirReviews) return [];
//                 const reviews = document.querySelectorAll('.jftiEf');
//                 return Array.from(reviews).slice(0, 3).map(review => ({
//                     texto: review.querySelector('.wiI7pd')?.textContent?.trim() || '',
//                     autor: review.querySelector('.d4r55')?.textContent?.trim() || '',
//                     rating: review.querySelector('.kvMYJc')?.getAttribute('aria-label') || ''
//                 }));
//             };

//             return {
//                 nome: getNome(),
//                 endereco: getEndereco(),
//                 telefone: getTelefone(),
//                 avaliacao: getAvaliacao(),
//                 categoria: getCategoria(),
//                 horarios: getHorarios(),
//                 reviews: getReviews()
//             };
//         }, options);

//         return {
//             nome: dados.nome || "Não encontrado",
//             endereco: dados.endereco || "Não encontrado", 
//             telefone: dados.telefone || "Não encontrado",
//             avaliacao: dados.avaliacao || "Não encontrado",
//             categoria: dados.categoria || "Não encontrado",
//             horarios: dados.horarios || "Não encontrado",
//             reviews: dados.reviews || [],
//             link: link
//         };

//     } catch (error) {
//         console.error(`Erro no link ${link}:`, error.message);
//         return null;
//     } finally {
//         await subPage.close();
//     }
// }

// // Auto scroll
// async function autoScroll(page) {
//     await page.evaluate(async () => {
//         const scrollContainer = document.querySelector('[role="main"]') || document.body;
//         await new Promise((resolve) => {
//             let totalHeight = 0;
//             const distance = 200;
//             const timer = setInterval(() => {
//                 scrollContainer.scrollBy(0, distance);
//                 totalHeight += distance;

//                 if(totalHeight >= scrollContainer.scrollHeight - window.innerHeight){
//                     clearInterval(timer);
//                     resolve();
//                 }
//             }, 150);
//         });
//     });
// }

// app.listen(PORT, () => {
//     console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
//     console.log(`📱 Acesse: http://localhost:${PORT}`);
//     console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
// });

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

// Endpoint simplificado para scraping
app.post("/scrape-advanced", async (req, res) => {
    const { termoBusca, maxResults = 5 } = req.body; // Limite baixo para teste
    
    if (!termoBusca) {
        return res.status(400).json({ error: "Termo de busca não fornecido." });
    }

    // Verificar cache primeiro
    const cacheKey = `simple-${termoBusca}-${maxResults}`;
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
        console.log(`🚀 Iniciando scraping para: ${termoBusca}`);
        
        // Configuração específica para Render
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        const searchURL = `https://www.google.com/maps/search/${encodeURIComponent(termoBusca)}`;
        console.log(`📍 Acessando: ${searchURL}`);
        
        await page.goto(searchURL, { waitUntil: "domcontentloaded", timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Buscar links básicos
        const links = await page.evaluate(() => {
            const anchors = document.querySelectorAll('a[href*="/place/"]');
            return Array.from(anchors)
                .map(a => a.href)
                .filter((href, index, arr) => arr.indexOf(href) === index)
                .slice(0, 10); // Máximo 10 links
        });

        console.log(`🔗 Encontrados ${links.length} links`);

        // Processar apenas os primeiros links (sem paralelismo)
        const results = [];
        const linksToProcess = links.slice(0, Math.min(maxResults, 3)); // Máximo 3 para teste

        for (let i = 0; i < linksToProcess.length; i++) {
            const link = linksToProcess[i];
            console.log(`📝 Processando ${i + 1}/${linksToProcess.length}: ${link}`);
            
            try {
                const subPage = await browser.newPage();
                await subPage.goto(link, { waitUntil: "domcontentloaded", timeout: 10000 });
                await new Promise(resolve => setTimeout(resolve, 2000));

                const dados = await subPage.evaluate(() => {
                    const nome = document.querySelector('h1.DUwDvf')?.textContent?.trim() || 
                                document.querySelector('h1')?.textContent?.trim() || 'Nome não encontrado';
                    
                    const endereco = document.querySelector('button[data-item-id="address"] .W4Efsd')?.textContent?.trim() || 
                                    'Endereço não encontrado';
                    
                    const telefone = document.querySelector('button[data-item-id="phone"] .W4Efsd')?.textContent?.trim() || 
                                    'Telefone não encontrado';

                    return { nome, endereco, telefone };
                });

                results.push({
                    ...dados,
                    link: link
                });

                await subPage.close();
                console.log(`✅ Item ${i + 1} processado: ${dados.nome}`);
                
            } catch (error) {
                console.error(`❌ Erro no item ${i + 1}:`, error.message);
            }

            // Pausa entre itens
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const responseData = {
            resultados: results,
            total: results.length,
            termo: termoBusca,
            timestamp: new Date().toISOString()
        };

        // Salvar no cache
        cache.set(cacheKey, responseData);

        console.log(`✅ Scraping concluído: ${results.length} resultados`);
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
