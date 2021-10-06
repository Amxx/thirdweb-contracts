// Test imports
import { ethers } from "hardhat";
import { expect } from "chai";

// Types
import { AccessNFTPL } from "../../typechain/AccessNFTPL";
import { PackPL } from "../../typechain/PackPL";
import { Forwarder } from "../../typechain/Forwarder";
import { BytesLike } from "@ethersproject/bytes";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";

// Test utils
import { getContracts, Contracts } from "../../utils/tests/getContracts";
import { getURIs, getAmounts } from "../../utils/tests/params";
import { forkFrom, impersonate } from "../../utils/hardhatFork";
import { sendGaslessTx } from "../../utils/tests/gasless";
import linkTokenABi from "../../abi/LinkTokenInterface.json";
import { chainlinkVars } from "../../utils/chainlink";

describe("Open a pack", function () {
  // Signers
  let protocolAdmin: SignerWithAddress;
  let creator: SignerWithAddress;
  let relayer: SignerWithAddress;

  // Contracts
  let pack: PackPL;
  let accessNft: AccessNFTPL;
  let forwarder: Forwarder;

  // Reward parameters
  const [packURI]: string[] = getURIs(1);
  const rewardURIs: string[] = getURIs();
  const accessURIs = getURIs(rewardURIs.length);
  const rewardSupplies: number[] = getAmounts(rewardURIs.length);
  const openStartAndEnd: number = 0;
  const rewardsPerOpen: number = 1;

  // Token IDs
  let packId: number;
  let rewardIds: number[];

  // Network
  const networkName = "rinkeby";

  const createPack = async (
    _packCreator: SignerWithAddress,
    _rewardIds: number[],
    _rewardAmounts: number[],
    _encodedParamsAsData: BytesLike,
  ) => {
    await sendGaslessTx(_packCreator, forwarder, relayer, {
      from: _packCreator.address,
      to: accessNft.address,
      data: accessNft.interface.encodeFunctionData("safeBatchTransferFrom", [
        _packCreator.address,
        pack.address,
        _rewardIds,
        _rewardAmounts,
        _encodedParamsAsData,
      ]),
    });
  };

  const encodeParams = (
    packURI: string,
    secondsUntilOpenStart: number,
    secondsUntilOpenEnd: number,
    rewardsPerOpen: number,
  ) => {
    return ethers.utils.defaultAbiCoder.encode(
      ["string", "uint256", "uint256", "uint256"],
      [packURI, secondsUntilOpenStart, secondsUntilOpenEnd, rewardsPerOpen],
    );
  };

  // Fund `Pack` with LINK
  const fundPack = async () => {
    const { linkTokenAddress } = chainlinkVars[networkName];

    const linkHolderAddress: string = "0xa7a82dd06901f29ab14af63faf3358ad101724a8";
    await impersonate(linkHolderAddress);
    const linkHolder: SignerWithAddress = await ethers.getSigner(linkHolderAddress);

    const linkContract = await ethers.getContractAt(linkTokenABi, linkTokenAddress);
    linkContract.connect(linkHolder).transfer(pack.address, ethers.utils.parseEther("1"));
  };

  before(async () => {
    // Fork rinkeby for testing
    await forkFrom(networkName);

    // Get signers
    const signers: SignerWithAddress[] = await ethers.getSigners();
    [protocolAdmin, creator, relayer] = signers;
  });

  beforeEach(async () => {
    // Get contracts
    const contracts: Contracts = await getContracts(protocolAdmin, networkName);
    pack = contracts.pack;
    accessNft = contracts.accessNft;
    forwarder = contracts.forwarder;

    // Create Access NFTs as rewards
    await sendGaslessTx(creator, forwarder, relayer, {
      from: creator.address,
      to: accessNft.address,
      data: accessNft.interface.encodeFunctionData("createAccessNfts", [rewardURIs, accessURIs, rewardSupplies]),
    });

    // Get pack ID
    packId = parseInt((await pack.nextTokenId()).toString());

    // Get rewardIds
    const nextAccessNftId: number = parseInt((await accessNft.nextTokenId()).toString());
    const expectedRewardIds: number[] = [];
    for (let val of [...Array(nextAccessNftId).keys()]) {
      if (val % 2 != 0) {
        expectedRewardIds.push(val);
      }
    }

    rewardIds = expectedRewardIds;
  });

  describe("Revert cases", function () {
    it("Should revert if window to openPack has ended", async () => {
      const secondsUntilOpenEnd: number = 100;

      // Create packs
      await createPack(
        creator,
        rewardIds,
        rewardSupplies,
        encodeParams(packURI, openStartAndEnd, secondsUntilOpenEnd, rewardsPerOpen),
      );

      // Time travel
      for (let i = 0; i < secondsUntilOpenEnd; i++) {
        await ethers.provider.send("evm_mine", []);
      }

      await expect(pack.connect(creator).openPack(packId)).to.be.revertedWith(
        "Pack: the window to open packs has not started or closed.",
      );
    });

    it("Should revert if the Pack contract has no LINK", async () => {
      // Create packs
      await createPack(
        creator,
        rewardIds,
        rewardSupplies,
        encodeParams(packURI, openStartAndEnd, openStartAndEnd, rewardsPerOpen),
      );

      await expect(pack.connect(creator).openPack(packId)).to.be.revertedWith(
        "Pack: Not enough LINK to fulfill randomness request.",
      );
    });

    it("Should revert if caller has no packs", async () => {
      // Create packs
      await createPack(
        creator,
        rewardIds,
        rewardSupplies,
        encodeParams(packURI, openStartAndEnd, openStartAndEnd, rewardsPerOpen),
      );

      // Fund pack contract with LINK
      await fundPack();

      await expect(pack.connect(protocolAdmin).openPack(packId)).to.be.revertedWith(
        "Pack: sender owns no packs of the given packId.",
      );
    });

    it("Should revert if caller has an in-flight pack open request for the pack", async () => {
      // Create packs
      await createPack(
        creator,
        rewardIds,
        rewardSupplies,
        encodeParams(packURI, openStartAndEnd, openStartAndEnd, rewardsPerOpen),
      );

      // Fund pack contract with LINK
      await fundPack();

      await pack.connect(creator).openPack(packId);

      await expect(pack.connect(creator).openPack(packId)).to.be.revertedWith(
        "Pack: must wait for the pending pack to be opened.",
      );
    });
  });

  describe("Events", function () {
    beforeEach(async () => {
      // Create packs
      await createPack(
        creator,
        rewardIds,
        rewardSupplies,
        encodeParams(packURI, openStartAndEnd, openStartAndEnd, rewardsPerOpen),
      );

      // Fund pack contract with LINK
      await fundPack();
    });

    it("Should emit PackOpenRequest", async () => {
      const eventPromise = new Promise((resolve, reject) => {
        pack.on("PackOpenRequest", (_packId, _opener, _requestId) => {
          expect(_packId).to.equal(packId);
          expect(_opener).to.equal(creator.address);

          resolve(null);
        });

        setTimeout(() => {
          reject(new Error("Timeout PackOpenRequest"));
        }, 5000);
      });

      await sendGaslessTx(creator, forwarder, relayer, {
        from: creator.address,
        to: pack.address,
        data: pack.interface.encodeFunctionData("openPack", [packId]),
      });

      try {
        await eventPromise;
      } catch (e) {
        console.error(e);
      }
    });
  });

  describe("Balances", function () {
    beforeEach(async () => {
      // Create packs
      await createPack(
        creator,
        rewardIds,
        rewardSupplies,
        encodeParams(packURI, openStartAndEnd, openStartAndEnd, rewardsPerOpen),
      );

      // Fund pack contract with LINK
      await fundPack();
    });

    it("Should decrement the opener's balance by 1", async () => {
      const balBefore: BigNumber = await pack.balanceOf(creator.address, packId);

      await sendGaslessTx(creator, forwarder, relayer, {
        from: creator.address,
        to: pack.address,
        data: pack.interface.encodeFunctionData("openPack", [packId]),
      });

      const balAfter: BigNumber = await pack.balanceOf(creator.address, packId);

      expect(balBefore.sub(balAfter)).to.equal(1);
    });
  });

  describe("Contract state", function () {
    beforeEach(async () => {
      // Create packs
      await createPack(
        creator,
        rewardIds,
        rewardSupplies,
        encodeParams(packURI, openStartAndEnd, openStartAndEnd, rewardsPerOpen),
      );

      // Fund pack contract with LINK
      await fundPack();

      // Open pack
      await sendGaslessTx(creator, forwarder, relayer, {
        from: creator.address,
        to: pack.address,
        data: pack.interface.encodeFunctionData("openPack", [packId]),
      });
    });

    it("Should update the randomnessRequests mapping with opener and request info", async () => {
      const requestId: BytesLike = await pack.currentRequestId(packId, creator.address);
      const requestInfo = await pack.randomnessRequests(requestId);

      expect(requestInfo.packId).to.equal(packId);
      expect(requestInfo.opener).to.equal(creator.address);
    });
  });
});