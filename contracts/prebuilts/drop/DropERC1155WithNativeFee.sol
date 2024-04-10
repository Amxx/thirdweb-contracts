// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.11;

/// @author amxx

//   $$\     $$\       $$\                 $$\                         $$\
//   $$ |    $$ |      \__|                $$ |                        $$ |
// $$$$$$\   $$$$$$$\  $$\  $$$$$$\   $$$$$$$ |$$\  $$\  $$\  $$$$$$\  $$$$$$$\
// \_$$  _|  $$  __$$\ $$ |$$  __$$\ $$  __$$ |$$ | $$ | $$ |$$  __$$\ $$  __$$\
//   $$ |    $$ |  $$ |$$ |$$ |  \__|$$ /  $$ |$$ | $$ | $$ |$$$$$$$$ |$$ |  $$ |
//   $$ |$$\ $$ |  $$ |$$ |$$ |      $$ |  $$ |$$ | $$ | $$ |$$   ____|$$ |  $$ |
//   \$$$$  |$$ |  $$ |$$ |$$ |      \$$$$$$$ |\$$$$$\$$$$  |\$$$$$$$\ $$$$$$$  |
//    \____/ \__|  \__|\__|\__|       \_______| \_____\____/  \_______|\_______/

//  ==========  Internal imports    ==========

import "./DropERC1155.sol";

contract DropERC1155WithNativeFee is DropERC1155 {
    function collectPriceOnClaim(
        uint256 _tokenId,
        address _primarySaleRecipient,
        uint256 _quantityToClaim,
        address _currency,
        uint256 _pricePerToken
    ) internal virtual override {
        // Sale price and recipient
        uint256 price = _quantityToClaim * _pricePerToken;
        address recipient =
            _primarySaleRecipient != address(0)
            ? _primarySaleRecipient
            : saleRecipient[_tokenId] != address(0)
            ? saleRecipient[_tokenId]
            : primarySaleRecipient();

        // Platform fee and recipient
        uint256 platformFee;
        address platformFeeRecipient;
        if (getPlatformFeeType() == PlatformFeeType.Bps) {
            uint16 platformFeeBps;
            (platformFeeRecipient, platformFeeBps) = getPlatformFeeInfo();
            platformFee = price * platformFeeBps / 10_000;
        } else {
            (platformFeeRecipient, platformFee) = getFlatPlatformFeeInfo();
        }

        // Check value sent
        require(msg.value == (_currency == CurrencyTransferLib.NATIVE_TOKEN ? price : 0) + platformFee, "!V");

        // Perform transfers
        CurrencyTransferLib.transferCurrency(CurrencyTransferLib.NATIVE_TOKEN, _msgSender(), platformFeeRecipient, platformFee);
        CurrencyTransferLib.transferCurrency(_currency, _msgSender(), recipient, price);
    }
}
