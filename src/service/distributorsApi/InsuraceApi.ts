import axios from 'axios';
import NetConfig from '../config/NetConfig'
import BigNumber from 'bignumber.js'
import ERC20Helper from '../helpers/ERC20Helper';
import RiskCarriers from '../config/RiskCarriers'
import CatalogHelper from '../helpers/catalogHelper'
import CurrencyHelper from '../helpers/currencyHelper'
import {toBN,fromWei, toWei} from 'web3-utils'
import Filters from "../helpers/filters";
import {getCoverMin} from "../helpers/cover_minimums"
// import * as Sentry from "@sentry/browser";

class InsuraceApi {

    static fetchCoverables (netId : any): Promise<object> {

      const netConfig = NetConfig.netById(netId);

        return axios.post(
            `${netConfig.insuraceAPI}/getProductList?code=${encodeURIComponent(netConfig.insuraceAPIKey)}`, {
            chain: netConfig.symbol
        })
        .then((response:any) => {
            return response.data;
        }).catch(error =>{
          global.sentry.captureException(error);
          return [];
        });
    }

    static getCurrencyList (_networkId:any) {

        return axios.post(
            `${NetConfig.netById(_networkId).insuraceAPI}/getCurrencyList?code=${encodeURIComponent(NetConfig.netById(_networkId).insuraceAPIKey)}`, {
            chain: NetConfig.netById(_networkId).symbol
        })
        .then((response:any) => {
            return response.data;
        }).catch(error =>{
          global.sentry.captureException(error);
        });
    }

    static async getCoverPremium (
        web3:any,
        amount : any,
        currency : any,
        period : any,
        protocolId : any,
        owner : any,
        protocolType : any,
        coveredID: any) {

        let url = `${NetConfig.netById(web3.networkId).insuraceAPI}/getCoverPremiumV2?code=${encodeURIComponent(NetConfig.netById(web3.networkId).insuraceAPIKey)}`;
        let object = {
            "chain": NetConfig.netById(web3.networkId).symbol,
            "coverCurrency": currency,
            "premiumCurrency": currency,
            "productIds": [protocolId],
            "coverDays": [period],
            "coverAmounts": [amount],
            "owner": owner,
            "referralCode": NetConfig.netById(web3.networkId).insuraceReferral,
            "coveredAccounts": protocolType == 'custodian' ? [coveredID] : [],
            "coveredAddresses": protocolType == 'custodian' ? [] : [owner],
        };
        return  axios.post(
            url, object).then((response : any) => {
            return response.data;
        })
    }

    static async getMultipleCoverPremiums (
        web3:any,
        amounts : any[],
        currency : any,
        periods : any[],
        protocolIds : any[]
      ) {

        let url = `${NetConfig.netById(web3.networkId).insuraceAPI}/getCoverPremiumV2?code=${encodeURIComponent(NetConfig.netById(web3.networkId).insuraceAPIKey)}`;

        return  axios.post(
            url, {
                    "chain": NetConfig.netById(web3.networkId).symbol,
                    "coverCurrency": currency.address,
                    "premiumCurrency": currency,
                    "productIds": protocolIds,
                    "coverDays": periods,
                    "coverAmounts": amounts,
                    "coveredAddresses": [global.user.account],
                    "coveredAccounts": [],      //custodians
                    "owner": global.user.account,
                    "referralCode": NetConfig.netById(web3.networkId).insuraceReferral,

        }).then((response : any) => {
          let quote:any = response.data;
          quote.currency = currency;
          return quote;
        })
    }

    static confirmCoverPremium (chainSymbol :any, params : any) {

        return axios.post(
            `${NetConfig.netById(global.user.networkId).insuraceAPI}/confirmCoverPremiumV2?code=${encodeURIComponent(NetConfig.netById(global.user.networkId).insuraceAPIKey)}`, {
            chain: chainSymbol,
            params: params
        }).then((response : any) => {
            return response.data;
        });
    }

    static async formatQuoteDataforInsurace(amount:any , currencyName:any, web3:any, protocol:any ) {

        let amountInWei:any= toWei(amount.toString(), 'ether');

        //fallbacks for USD (normal and de-peg)
        if (currencyName.includes('USD') && protocol.name.includes('De-Peg')) {
            currencyName = this.insuraceDePegCurrency(protocol, currencyName, web3.symbol);
        }
        else if (currencyName === 'USD') {
            currencyName = RiskCarriers.INSURACE.fallbackQuotation[NetConfig.netById(web3.networkId).symbol];
        }

        let currencies:object[] = await this.getCurrencyList(web3.networkId);
        let selectedCurrency:any = currencies.find((curr:any) => {return curr.name == currencyName});

        if (!selectedCurrency) {
            return {error: `Selected currency is not supported by InsurAce: ${currencyName} on net ${web3.networkId}`};
        }

        if (NetConfig.sixDecimalsCurrency(web3.networkId, currencyName)) {
            amountInWei = ERC20Helper.ERCtoUSDTDecimals(amountInWei);
        }

        return {amountInWei: amountInWei, currency:currencyName, selectedCurrency: selectedCurrency}

    }

    static insuraceDePegCurrency(protocol:any,currency:any,web3Symbol:any) : any {
        let currencyName:any = 'ETH';
        if(!protocol.name){
            return currencyName;
        }
        if(currency !== 'ETH'){
            if (protocol.name.includes('USDT') || protocol.name.includes('BUSD')) {
                switch (web3Symbol) {
                    case "ETH":
                    case "BSC":
                    case "POLYGON":
                        currencyName = 'USDC';
                        break;
                    case "AVALANCHE":
                        currencyName = 'USDCe';
                        break;
                }
            } else if (protocol.name.includes('USDC')) {
                switch (web3Symbol) {
                    case "ETH":
                        currencyName = 'USDT';
                        break;
                    case "BSC":
                        currencyName = 'BUSD-T';
                        break;
                    case "POLYGON":
                        currencyName = 'USDT';
                        break;
                    case "AVALANCHE":
                        currencyName = 'USDTe';
                        break;
                }
            }
            return currencyName;
        }
        return currencyName;
    }

    static formatCapacity(_currency:any, _quoteCapacity:any, _chain:any ){
      if(_currency === 'ETH') {
        return CurrencyHelper.usd2eth(ERC20Helper.USDTtoERCDecimals(_quoteCapacity ) )
      } else {
        if(_chain == "BSC"){
          return _quoteCapacity;
        }else {
          return ERC20Helper.USDTtoERCDecimals(_quoteCapacity);
        }
      }
    }

    static async fetchInsuraceQuote ( web3:any, amount:string | number, currency:string , period:number, protocol:any, owner:any): Promise<object> {

      let quoteData = await this.formatQuoteDataforInsurace(amount, currency, web3, protocol);

        if (!quoteData.selectedCurrency) {
          return {error: `Selected currency is not supported by InsurAce: ${currency} on net ${web3.networkId}`};
        }

        web3.symbol = NetConfig.netById(web3.networkId).symbol;

        const minimumAmount = getCoverMin("insurace", web3.symbol, quoteData.selectedCurrency.name );

        let quote:any = CatalogHelper.quoteFromCoverable(
          'insurace',
          protocol,
          {
            status: "INITIAL_DATA",
            amount: quoteData.amountInWei,
            currency: quoteData.selectedCurrency.name,
            period: period,
            chain: web3.symbol,
            chainId: web3.networkId,
            minimumAmount: minimumAmount,
            type: protocol.type,
          },
          {
            remainingCapacity: protocol['stats_'+web3.symbol] ? protocol['stats_'+web3.symbol].capacityRemaining : 0
          }
        );
        return await this.getCoverPremium(
          web3,
          quoteData.amountInWei,
          quoteData.selectedCurrency.address,
          period,
          parseInt(protocol.productId),
          global.user.account,
          protocol.type,
          owner,
        ).then( async (response: any) => {
            let premium: any = response.premiumAmount;

            if (NetConfig.sixDecimalsCurrency(web3.networkId, quoteData.currency)) {
                premium = ERC20Helper.USDTtoERCDecimals(premium);
                quoteData.amountInWei =  ERC20Helper.USDTtoERCDecimals(quoteData.amountInWei);
            }

            const pricePercent = new BigNumber(premium).times(1000).dividedBy(quoteData.amountInWei).dividedBy(new BigNumber(period)).times(365).times(100).dividedBy(1000);

            quote.price = premium,
            quote.rawData = response,
            quote.pricePercent= pricePercent;

            global.events.emit("quote" , quote );

            const cashbackInInsur = Number(fromWei(response.ownerInsurReward));
            let cashbackInQuoteCurrency:any = cashbackInInsur * CurrencyHelper.insurPrice();

            if (quoteData.currency == "ETH") {
              cashbackInQuoteCurrency = fromWei(CurrencyHelper.usd2eth(toWei(cashbackInQuoteCurrency.toString())));
            }

            let cashBackPercent:number = (cashbackInQuoteCurrency / Number(fromWei(premium))) * 100;

            cashBackPercent = cashBackPercent ? Number(cashBackPercent.toFixed(1)) : 7.5;

            const quoteCapacity:any = this.formatCapacity( currency , protocol['stats_'+web3.symbol] ? protocol['stats_'+web3.symbol].capacityRemaining : 0 , web3.symbol );

            quote.cashBackPercent = cashBackPercent;
            quote.cashBack = [ cashbackInInsur , cashbackInQuoteCurrency ];
            quote.capacity= quoteCapacity;
            quote.status= "FINAL_DATA";

            return quote;
        })
            .catch((e) => {

                let errorMsg:any = { message: e.response && e.response.data ? e.response.data.message : e.message }

                let defaultCapacity = protocol['stats_'+web3.symbol] ? protocol['stats_'+web3.symbol].capacityRemaining : 0;

                const quoteCapacity:any = this.formatCapacity( currency , protocol['stats_'+web3.symbol] ? protocol['stats_'+web3.symbol].capacityRemaining : 0 , web3.symbol );

                if (errorMsg.message.match('GP: 4') || errorMsg.message.includes('cover duration is either too small or')) {
                  errorMsg = {message:"Minimum duration is 15 days. Maximum is 90" , errorType: "period" }

                } else if (errorMsg.message.includes('exceeds available capacity') || errorMsg.message.includes('undefined') || errorMsg.message.includes('Invalid covered address')) {
                  let capacityCurrency = web3.symbol == "POLYGON" ? "MATIC" : web3.symbol == "BSC" ? "BNB" : "ETH";
                  errorMsg = { message: `Maximum available capacity is `, capacity: fromWei(quoteCapacity.toString()), currency: capacityCurrency, errorType:"capacity"}
                }

                quote.errorMsg = errorMsg;
                quote.capacity = quoteCapacity;
                quote.remainingCapacity = defaultCapacity;
                quote.status= "FINAL_DATA";

                return quote;
            })
    }

}
export default InsuraceApi;
