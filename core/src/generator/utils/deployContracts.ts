import * as hre from "hardhat";
import { Logger } from "@nestjs/common";
import { ethers } from "ethers";
import { BatchTransferV1, BatchTransferV1__factory, GameItem, GameItem__factory, GLDToken, IERC20, GLDToken__factory, Multicall, Multicall__factory, UniswapV2Factory, UniswapV2Factory__factory, UniswapV2Router02, UniswapV2Router02__factory, WETH9, WETH9__factory, IERC20__factory } from "../contracts/types";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import * as zkSyncWeb3 from "zksync-web3";

class ContractDeployer {
  _gld2TokenContract: GLDToken | ethers.Contract;
  _weth9: WETH9;
  _fundingContract: BatchTransferV1 | ethers.Contract;
  _gldTokenContract: GLDToken | ethers.Contract;
  _zkBaseTokenContractL1: IERC20;
  _uni: {
    factory: UniswapV2Factory | ethers.Contract;
    router: UniswapV2Router02 | ethers.Contract;
    multicall: Multicall | ethers.Contract;
  }
  _nftContract: GameItem | ethers.Contract;

  async getFundingContract(signer: ethers.Wallet | zkSyncWeb3.Wallet) {
    if (this._fundingContract) {
      return this._fundingContract.connect(signer);
    }

    if (process.env.BATCH_TRANSFER_CONTRACT_ADDRESS) {
      const contract = new ethers.Contract(
        process.env.BATCH_TRANSFER_CONTRACT_ADDRESS,
        BatchTransferV1__factory.createInterface(),
        signer,
      );

      this._fundingContract = contract;

      return this._fundingContract;
    }

    let contract;

    if(signer instanceof zkSyncWeb3.Wallet) {
      const wallet = new zkSyncWeb3.Wallet(signer.privateKey);
      // Create deployer object and load the artifact of the contract we want to deploy.
      const deployer = new Deployer(hre, wallet);
      const artifact = await deployer.loadArtifact("BatchTransferV1");
    
      // Deploy this contract. The returned object will be of a `Contract` type, similarly to ones in `ethers`.
      contract = await deployer.deploy(artifact, []);
    } else {
      const contractFactory = new BatchTransferV1__factory(signer);
      contract = await contractFactory.deploy();
    }

    Logger.log(
      `Deploy batch transfer contract success, contract address ${contract.address}`,
    );

    this._fundingContract = contract;

    return this._fundingContract;
  };

  async getZKBaseTokenTokenContractL1(signer: ethers.Wallet, zkCROAddress: string) {
    if (this._zkBaseTokenContractL1) {
      return this._zkBaseTokenContractL1.connect(signer);
    }

    const contract = IERC20__factory.connect(zkCROAddress, signer);


    this._zkBaseTokenContractL1 = contract;

    return this._zkBaseTokenContractL1;
  }

  async getGLDTokenContract(signer: ethers.Wallet | zkSyncWeb3.Wallet) {
    if (this._gldTokenContract) {
      return this._gldTokenContract.connect(signer);
    }

    let contract;

    if(signer instanceof zkSyncWeb3.Wallet) {
      const wallet = new zkSyncWeb3.Wallet(signer.privateKey);
      // Create deployer object and load the artifact of the contract we want to deploy.
      const deployer = new Deployer(hre, wallet);
      const artifact = await deployer.loadArtifact("GLDToken");
    
      // Deploy this contract. The returned object will be of a `Contract` type, similarly to ones in `ethers`.
      contract = await deployer.deploy(artifact, ["Gold", "GLD", 18]);

    } else {
      const contractFactory = new GLDToken__factory(signer);
      contract = await contractFactory.deploy("Gold", "GLD", 18);
    }

    Logger.log(`Deploy GLD token success,${signer instanceof zkSyncWeb3.Wallet ? ' zkSync' : ''} contract address ${contract.address}`);

    this._gldTokenContract = contract;

    return this._gldTokenContract;
  }

  async getGLD2TokenContract(signer: ethers.Wallet | zkSyncWeb3.Wallet) {
    if (this._gld2TokenContract) {
      return this._gld2TokenContract.connect(signer);
    }

    let contract;

    if(signer instanceof zkSyncWeb3.Wallet) {
      const wallet = new zkSyncWeb3.Wallet(signer.privateKey);
      // Create deployer object and load the artifact of the contract we want to deploy.
      const deployer = new Deployer(hre, wallet);
      const artifact = await deployer.loadArtifact("GLDToken");
    
      // Deploy this contract. The returned object will be of a `Contract` type, similarly to ones in `ethers`.
      contract = await deployer.deploy(artifact, ["Gold2", "GLD2", 18]);
    } else {
      const contractFactory = new GLDToken__factory(signer);
      contract = await contractFactory.deploy("Gold2", "GLD2", 18);
      await contract.deployed();
    }

    Logger.log(`Deploy GLD2 token success,${signer instanceof zkSyncWeb3.Wallet ? ' zkSync' : ''} contract address ${contract.address}`);

    this._gld2TokenContract = contract;

    return this._gld2TokenContract;
  }

  async getWETH9TokenContract(signer: ethers.Wallet | zkSyncWeb3.Wallet) {
    if (this._weth9) {
      return this._weth9.connect(signer);
    }

    let contract;

    if(signer instanceof zkSyncWeb3.Wallet) {
      const wallet = new zkSyncWeb3.Wallet(signer.privateKey);
      // Create deployer object and load the artifact of the contract we want to deploy.
      const deployer = new Deployer(hre, wallet);
      const artifact = await deployer.loadArtifact("WETH9");
    
      // Deploy this contract. The returned object will be of a `Contract` type, similarly to ones in `ethers`.
      contract = await deployer.deploy(artifact, []);
    } else {
      const weth9Factory = new WETH9__factory(signer);
      contract = await weth9Factory.deploy()
      await contract.deployed();
    }

    Logger.log(`Deploy WETH9 token success,${signer instanceof zkSyncWeb3.Wallet ? ' zkSync' : ''} contract address ${contract.address}`);

    this._weth9 = contract;
    return this._weth9;
  }

  async getUniSwapTokenContracts(signer: ethers.Wallet | zkSyncWeb3.Wallet) {
    if (this._uni) {
      return {
        factory: this._uni.factory.connect(signer),
        router: this._uni.router.connect(signer),
        multicall: this._uni.multicall.connect(signer),
      };
    }

    const weth9 = await this.getWETH9TokenContract(signer);

    if(signer instanceof zkSyncWeb3.Wallet) {
      const wallet = new zkSyncWeb3.Wallet(signer.privateKey);
      // Create deployer object and load the artifact of the contract we want to deploy.
      const deployer = new Deployer(hre, wallet);
      const artifactFactory = await deployer.loadArtifact("UniswapV2Factory");
    
      // Deploy this contract. The returned object will be of a `Contract` type, similarly to ones in `ethers`.
      Logger.log("Deploying UniswapV2Factory......");
      const factory = await deployer.deploy(artifactFactory, [signer.address]);
      Logger.log("UniswapV2Factory zkSync contract address: " + factory.address);

      const artifactRouter = await deployer.loadArtifact("UniswapV2Router02");
    
      // Deploy this contract. The returned object will be of a `Contract` type, similarly to ones in `ethers`.
      Logger.log("Deploying UniswapV2Router02......");
      const router = await deployer.deploy(artifactRouter, [factory.address, weth9.address]);
      Logger.log("UniswapV2Router02 zkSync contract address: " + router.address);

      const artifactMulticall = await deployer.loadArtifact("Multicall");
    
      // Deploy this contract. The returned object will be of a `Contract` type, similarly to ones in `ethers`.
      Logger.log("Deploying Multicall......");
      const multicall = await deployer.deploy(artifactMulticall, []);
      Logger.log("Multicall zkSync contract address: " + multicall.address);
      
      this._uni = {
        factory,
        router,
        multicall
      }

      return this._uni;
    }

    Logger.log("Deploying UniswapV2Factory......");
    const factoryFactory = new UniswapV2Factory__factory(signer);
    const factory = await factoryFactory.deploy(signer.address);
    await factory.deployed()
    Logger.log("UniswapV2Factory address: " + factory.address);

    Logger.log("Deploying UniswapV2Router02......");
    const routerFactory = new UniswapV2Router02__factory(signer);
    const router = await routerFactory.deploy(factory.address, weth9.address);
    await router.deployed();
    Logger.log("UniswapV2Router02 address: " + router.address);

    Logger.log("Deploying Multicall......");
    const multicallFactory = new Multicall__factory(signer);
    const multicall = await multicallFactory.deploy();
    await multicall.deployed();
    Logger.log("Multicall address: " + multicall.address);

    this._uni = {
      factory,
      router,
      multicall
    }

    return this._uni;
  }

  async getNFTContract(signer: ethers.Wallet | zkSyncWeb3.Wallet) {
    if (this._nftContract) {
      return this._nftContract.connect(signer);
    }

    let contract;

    if(signer instanceof zkSyncWeb3.Wallet) {
      const wallet = new zkSyncWeb3.Wallet(signer.privateKey);
      // Create deployer object and load the artifact of the contract we want to deploy.
      const deployer = new Deployer(hre, wallet);
      const artifact = await deployer.loadArtifact("GameItem");
    
      // Deploy this contract. The returned object will be of a `Contract` type, similarly to ones in `ethers`.
      contract = await deployer.deploy(artifact, []);
    } else {
      const contractFactory = new GameItem__factory(signer);
      contract = await contractFactory.deploy()
      await contract.deployed();
    }

    Logger.log(`Deploy NFT success,${signer instanceof zkSyncWeb3.Wallet ? ' zkSync' : ''} contract address ${contract.address}`);

    this._nftContract = contract;
    return this._nftContract;
  }
}


export const contractDeployer = new ContractDeployer();