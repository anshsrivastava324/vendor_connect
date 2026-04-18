class VendorDashboard {
    constructor() {
        this.currentUser = null;
        this.userProfile = null;
        this.cart = [];
        this.availableItems = [];
        this.availableItemsById = new Map();
        this.availableItemsByName = new Map();
        this.supplierProfilesById = new Map();
        this.selectedIngredients = new Map();
        this.currentIngredients = [];
        this.currentRecipe = null;
        
        this.init();
    }

    async init() {
        this.currentUser = supabase.auth.getCurrentUser();
        this.userProfile = JSON.parse(localStorage.getItem('user_profile') || '{}');

        if (!this.currentUser || this.userProfile.user_type !== 'vendor') {
            window.location.href = 'vendor-login.html';
            return;
        }

        this.setupEventListeners();
        this.updateUserDisplay();
        await this.loadSupplierItems();
        await this.loadCart();
    }

    setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const tab = e.currentTarget.dataset.tab;
                this.switchTab(tab);
            });
        });

        // Search functionality
        document.getElementById('searchBtn').addEventListener('click', () => this.searchIngredients());
        document.getElementById('dishInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.searchIngredients();
        });
        document.getElementById('getRecipeBtn').addEventListener('click', () => this.openRecipeModal());
        document.getElementById('closeRecipeModal').addEventListener('click', () => this.closeRecipeModal());
        document.getElementById('recipeModal').addEventListener('click', (e) => {
            if (e.target.id === 'recipeModal') {
                this.closeRecipeModal();
            }
        });

        // Add all selected ingredients
        document.getElementById('addAllBtn').addEventListener('click', () => this.addSelectedIngredients());

        // Logout
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());

        // Checkout
        document.getElementById('checkoutBtn').addEventListener('click', () => this.checkout());

        // Browse filters
        document.getElementById('browseSearchBtn').addEventListener('click', () => this.filterBrowseItems());
        document.getElementById('browseSearchInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.filterBrowseItems();
            }
        });
        document.getElementById('categoryFilter').addEventListener('change', () => this.filterBrowseItems());
    }

    updateUserDisplay() {
        document.getElementById('userName').textContent = this.userProfile.name || 'Vendor';
    }

    switchTab(tabName) {
        // Update active menu item
        document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update active tab content
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        document.getElementById(`${tabName}Tab`).classList.add('active');

        // Load tab-specific data
        if (tabName === 'orders') {
            this.loadOrders();
        }

        if (tabName === 'browse') {
            this.filterBrowseItems();
        }
    }

    async searchIngredients() {
        const dishName = document.getElementById('dishInput').value.trim();
        if (!dishName) return;

        const searchBtn = document.getElementById('searchBtn');
        const spinner = document.getElementById('searchSpinner');
        const resultsDiv = document.getElementById('ingredientsResult');

        // Show loading
        searchBtn.disabled = true;
        spinner.classList.remove('hidden');
        resultsDiv.classList.add('hidden');
        this.currentRecipe = null;
        this.setRecipeButtonVisibility(false);
        this.closeRecipeModal();

        try {
            const response = await fetch(`https://api.spoonacular.com/recipes/complexSearch?query=${encodeURIComponent(dishName)}&apiKey=${SPOONACULAR_API_KEY}&addRecipeInformation=true&fillIngredients=true&instructionsRequired=true&number=5`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch ingredients');
            }

            const data = await response.json();
            
            if (data.results && data.results.length > 0) {
                const topRecipe = this.pickBestRecipe(data.results, dishName);
                if (!topRecipe) {
                    this.showNoResults();
                    this.setRecipeButtonVisibility(false);
                    return;
                }
                const extendedIngredients = Array.isArray(topRecipe.extendedIngredients)
                    ? topRecipe.extendedIngredients
                    : [];

                this.currentIngredients = extendedIngredients.map(ingredient => ({
                    id: ingredient.id,
                    name: ingredient.name,
                    amount: ingredient.amount || 1,
                    unit: ingredient.unit || 'piece',
                    image: ingredient.image
                }));

                this.currentRecipe = this.buildRecipeDetails(topRecipe);
                this.setRecipeButtonVisibility(this.currentRecipe !== null);

                this.displayIngredients(dishName);
                this.selectedIngredients.clear();
                this.updateSelectedCount();
            } else {
                this.showNoResults();
                this.setRecipeButtonVisibility(false);
            }
        } catch (error) {
            console.error('Error fetching ingredients:', error);
            alert('Failed to fetch ingredients. Please try again.');
            this.setRecipeButtonVisibility(false);
        } finally {
            searchBtn.disabled = false;
            spinner.classList.add('hidden');
        }
    }

    buildRecipeDetails(recipe) {
        if (!recipe || !Array.isArray(recipe.extendedIngredients) || recipe.extendedIngredients.length === 0) {
            return null;
        }

        const ingredientLines = recipe.extendedIngredients
            .map(ingredient => ingredient?.original || ingredient?.name)
            .filter(Boolean);

        if (ingredientLines.length === 0) {
            return null;
        }

        const steps = this.extractRecipeSteps(recipe);

        if (steps.length === 0) {
            return null;
        }

        return {
            title: recipe.title || 'Recipe',
            ingredients: ingredientLines,
            steps,
            readyInMinutes: recipe.readyInMinutes,
            servings: recipe.servings
        };
    }

    pickBestRecipe(recipes, dishName) {
        if (!Array.isArray(recipes) || recipes.length === 0) {
            return null;
        }

        const normalizedDishName = this.normalizeText(dishName);
        const scored = recipes
            .map(recipe => {
                const title = this.normalizeText(recipe?.title || '');
                const hasIngredients = Array.isArray(recipe?.extendedIngredients) && recipe.extendedIngredients.length > 0;
                const steps = this.extractRecipeSteps(recipe);
                const hasSteps = steps.length > 0;
                const titleMatchScore = title.includes(normalizedDishName) ? 2 : (normalizedDishName.includes(title) ? 1 : 0);
                const score = (hasIngredients ? 4 : 0) + (hasSteps ? 4 : 0) + titleMatchScore;

                return {
                    recipe,
                    score,
                    hasIngredients,
                    hasSteps
                };
            })
            .filter(item => item.hasIngredients && item.hasSteps)
            .sort((a, b) => b.score - a.score);

        return scored.length > 0 ? scored[0].recipe : null;
    }

    extractRecipeSteps(recipe) {
        const analyzedSteps = (recipe?.analyzedInstructions || [])
            .flatMap(section => section.steps || [])
            .map(step => this.cleanHtmlText(step?.step || ''))
            .filter(Boolean);

        if (analyzedSteps.length > 0) {
            return analyzedSteps;
        }

        const cleanedInstructions = this.cleanHtmlText(recipe?.instructions || '');
        if (!cleanedInstructions) {
            return [];
        }

        return cleanedInstructions
            .split(/(?:\r?\n)+|(?<=[.!?])\s+(?=[A-Z0-9])/)
            .map(step => step.trim())
            .filter(step => step.length > 10);
    }

    cleanHtmlText(text) {
        if (!text) return '';
        const holder = document.createElement('div');
        holder.innerHTML = text;
        return (holder.textContent || holder.innerText || '').trim();
    }

    escapeHtml(text) {
        if (!text) return '';
        const holder = document.createElement('div');
        holder.textContent = text;
        return holder.innerHTML;
    }

    setRecipeButtonVisibility(visible) {
        const recipeBtn = document.getElementById('getRecipeBtn');
        if (!recipeBtn) return;
        recipeBtn.classList.toggle('hidden', !visible);
    }

    openRecipeModal() {
        if (!this.currentRecipe) return;

        const recipeTitle = document.getElementById('recipeTitle');
        const recipeMeta = document.getElementById('recipeMeta');
        const recipeIngredients = document.getElementById('recipeIngredients');
        const recipeSteps = document.getElementById('recipeSteps');
        const recipeInstructionsHeading = document.getElementById('recipeInstructionsHeading');
        const recipeModal = document.getElementById('recipeModal');

        recipeTitle.textContent = this.currentRecipe.title;

        const metaParts = [];
        if (this.currentRecipe.readyInMinutes) {
            metaParts.push(`Ready in ${this.currentRecipe.readyInMinutes} min`);
        }
        if (this.currentRecipe.servings) {
            metaParts.push(`Serves ${this.currentRecipe.servings}`);
        }
        recipeMeta.textContent = metaParts.join(' • ');
        recipeMeta.classList.toggle('hidden', metaParts.length === 0);

        recipeIngredients.innerHTML = this.currentRecipe.ingredients
            .map(ingredient => `<li>${this.escapeHtml(ingredient)}</li>`)
            .join('');

        if (Array.isArray(this.currentRecipe.steps) && this.currentRecipe.steps.length > 0) {
            recipeInstructionsHeading.classList.remove('hidden');
            recipeSteps.innerHTML = this.currentRecipe.steps
                .map(step => `<li>${this.escapeHtml(step)}</li>`)
                .join('');
        } else {
            recipeInstructionsHeading.classList.add('hidden');
            recipeSteps.innerHTML = '<li>Recipe steps are not available for this dish.</li>';
        }

        recipeModal.classList.remove('hidden');
    }

    closeRecipeModal() {
        const recipeModal = document.getElementById('recipeModal');
        if (!recipeModal) return;
        recipeModal.classList.add('hidden');
    }

    displayIngredients(dishName) {
        document.getElementById('dishName').textContent = dishName;
        const ingredientsList = document.getElementById('ingredientsList');
        
        ingredientsList.innerHTML = this.currentIngredients.map(ingredient => `
            <div class="ingredient-card">
                <label class="ingredient-checkbox">
                    <input type="checkbox" data-ingredient-id="${ingredient.id}">
                    <div class="ingredient-content">
                        ${ingredient.image ? `
                            <img src="https://spoonacular.com/cdn/ingredients_100x100/${ingredient.image}" 
                                 alt="${ingredient.name}" class="ingredient-image">
                        ` : ''}
                        <div class="ingredient-info">
                            <span class="ingredient-name">${ingredient.name}</span>
                            <span class="ingredient-amount">${ingredient.amount} ${ingredient.unit}</span>
                            <span class="ingredient-selected-qty" id="selectedQty-${ingredient.id}"></span>
                        </div>
                    </div>
                </label>
            </div>
        `).join('');

        // Add checkbox event listeners
        ingredientsList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const ingredientId = parseInt(e.target.dataset.ingredientId);
                const ingredient = this.currentIngredients.find(item => item.id === ingredientId);

                if (!ingredient) {
                    e.target.checked = false;
                    return;
                }

                if (e.target.checked) {
                    const quantitySelection = this.promptIngredientQuantity(ingredient);
                    if (!quantitySelection) {
                        e.target.checked = false;
                        return;
                    }

                    this.selectedIngredients.set(ingredientId, quantitySelection);
                    this.updateIngredientSelectedQuantityText(ingredientId, quantitySelection);
                } else {
                    this.selectedIngredients.delete(ingredientId);
                    this.updateIngredientSelectedQuantityText(ingredientId, null);
                }
                this.updateSelectedCount();
            });
        });

        document.getElementById('ingredientsResult').classList.remove('hidden');
    }

    updateSelectedCount() {
        const count = this.selectedIngredients.size;
        document.getElementById('selectedCount').textContent = count;
        document.getElementById('addAllBtn').disabled = count === 0;
    }

    getOrderUnitFromIngredientUnit(rawUnit) {
        const unit = (rawUnit || '').toLowerCase();

        if (unit.includes('kg') || unit === 'g' || unit.includes('gram')) {
            return 'kg';
        }

        if (unit.includes('liter') || unit === 'l' || unit === 'ml') {
            return 'liter';
        }

        if (unit.includes('dozen') || unit.includes('piece') || unit.includes('pcs')) {
            return 'dozen';
        }

        return 'kg';
    }

    promptIngredientQuantity(ingredient) {
        const unit = this.getOrderUnitFromIngredientUnit(ingredient.unit);
        const minQty = 1;
        const maxQty = 20;

        const input = prompt(
            `Enter quantity for ${ingredient.name} (${unit}).\nMinimum: ${minQty} ${unit}\nMaximum: ${maxQty} ${unit}`,
            String(minQty)
        );

        if (input === null) {
            return null;
        }

        const quantity = Number(input);
        if (Number.isNaN(quantity) || quantity < minQty || quantity > maxQty) {
            alert(`Please enter a valid quantity between ${minQty} and ${maxQty} ${unit}.`);
            return null;
        }

        return {
            quantity,
            unit
        };
    }

    updateIngredientSelectedQuantityText(ingredientId, selection) {
        const textEl = document.getElementById(`selectedQty-${ingredientId}`);
        if (!textEl) return;

        if (!selection) {
            textEl.textContent = '';
            return;
        }

        textEl.textContent = `Selected order: ${selection.quantity} ${selection.unit}`;
    }

    async addSelectedIngredients() {
        if (this.selectedIngredients.size === 0) return;

        const selectedItems = this.currentIngredients.filter(ing => 
            this.selectedIngredients.has(ing.id)
        );

        for (const ingredient of selectedItems) {
            const selection = this.selectedIngredients.get(ingredient.id);
            await this.addToCart({
                name: ingredient.name,
                quantity: selection?.quantity || 1,
                unit: selection?.unit || this.getOrderUnitFromIngredientUnit(ingredient.unit),
                price: 0, // Price to be set by matching supplier items
                fromIngredients: true,
                dishName: document.getElementById('dishName').textContent
            });
        }

        this.selectedIngredients.clear();
        this.updateSelectedCount();
        document.querySelectorAll('#ingredientsList input[type="checkbox"]').forEach(cb => cb.checked = false);
        
        alert(`Added ${selectedItems.length} ingredients to cart!`);
        this.updateCartCount();
    }

    async addToCart(item) {
        try {
            const requestedQuantity = Number(item.quantity || 1);
            const supplierMatches = this.availableItems
                .filter(candidate =>
                    this.normalizeText(candidate.name) === this.normalizeText(item.name) &&
                    candidate.in_stock &&
                    Number(candidate.stock_quantity || 0) >= requestedQuantity
                )
                .sort((a, b) => Number(a.price || 0) - Number(b.price || 0));

            const directMatch = item.id ? supplierMatches.find(candidate => candidate.id === item.id) : null;
            const matchedItem = directMatch || supplierMatches[0] || null;

            const cartItem = {
                vendor_id: this.currentUser.id,
                supplier_id: this.normalizeNullableValue(matchedItem?.supplier_id || item.supplier_id),
                item_name: item.name,
                quantity: requestedQuantity,
                price: matchedItem?.price ?? item.price ?? 0,
                unit: item.unit,
                from_ingredients: item.fromIngredients || false,
                dish_name: item.dishName,
                item_id: this.normalizeNullableValue(matchedItem?.id || item.id)
            };

            await this.insertCartItem(cartItem);
            await this.loadCart();
        } catch (error) {
            console.error('Error adding to cart:', error);
        }
    }

    normalizeNullableValue(value) {
        if (value === undefined || value === null) return null;
        const normalized = String(value).trim();
        if (!normalized || normalized.toLowerCase() === 'null' || normalized.toLowerCase() === 'undefined') {
            return null;
        }
        return normalized;
    }

    async insertCartItem(cartItem) {
        const basePayload = {
            ...cartItem,
            vendor_id: this.normalizeNullableValue(cartItem.vendor_id),
            supplier_id: this.normalizeNullableValue(cartItem.supplier_id),
            item_id: this.normalizeNullableValue(cartItem.item_id)
        };

        const fallbackPayloads = [
            basePayload,
            { ...basePayload, supplier_id: null, item_id: null },
            (({ supplier_id, item_id, ...rest }) => rest)(basePayload),
            (({ vendor_id, supplier_id, item_id, ...rest }) => rest)(basePayload)
        ];

        let lastError = null;
        for (const payload of fallbackPayloads) {
            try {
                await supabase.database.from('cart_items').insert(payload);
                return;
            } catch (error) {
                lastError = error;
                const isForbidden = String(error?.message || '').includes('403');
                if (!isForbidden) {
                    throw error;
                }
            }
        }

        throw lastError || new Error('Unable to add cart item due to permissions.');
    }

    async loadCart() {
        try {
            const cartItems = await supabase.database
                .from('cart_items')
                .select()
                .eq('vendor_id', this.currentUser.id)
                .execute();

            this.cart = this.resolveCartItems(cartItems);

            this.updateCartCount();
            this.displayCart();
        } catch (error) {
            console.error('Error loading cart:', error);
        }
    }

    updateCartCount() {
        document.getElementById('cartCount').textContent = this.cart.length;
    }

    getUnavailableCartItems() {
        return this.cart.filter(item => !item.is_available);
    }

    updateCheckoutState() {
        const checkoutBtn = document.getElementById('checkoutBtn');
        if (!checkoutBtn) return;

        const hasUnavailableItems = this.getUnavailableCartItems().length > 0;
        checkoutBtn.disabled = this.cart.length === 0 || hasUnavailableItems;
        checkoutBtn.title = hasUnavailableItems
            ? 'Some items in the cart are out of stock.'
            : 'Place order';
    }

    normalizeText(value) {
        return (value || '').trim().toLowerCase();
    }

    resolveCartItems(cartItems) {
        return cartItems.map(item => {
            const resolved = this.resolveCartItem(item);
            return {
                ...item,
                is_available: resolved.isAvailable,
                supplier_name: resolved.supplierName,
                supplier_business_name: resolved.supplierBusinessName,
                item_stock_quantity: resolved.stockQuantity,
                availability_message: resolved.message,
                resolved_item_id: resolved.itemId,
                resolved_supplier_id: resolved.supplierId,
                resolved_item_name: resolved.itemName,
                resolved_price: resolved.price,
                supplier_options: resolved.supplierOptions,
                selected_supplier_item_id: resolved.selectedItemId
            };
        });
    }

    getSupplierOptionsForItem(item) {
        const requestedQuantity = Number(item.quantity || 0);
        const normalizedName = this.normalizeText(item.item_name);

        return this.availableItems
            .filter(candidate =>
                this.normalizeText(candidate.name) === normalizedName &&
                candidate.in_stock &&
                Number(candidate.stock_quantity || 0) >= requestedQuantity
            )
            .sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    }

    getSupplierDisplayName(supplierId, fallbackName = '') {
        const profile = this.supplierProfilesById.get(supplierId);
        return profile?.business_name || profile?.name || fallbackName || '';
    }

    getSupplierBusinessName(supplierId, fallbackName = '') {
        const profile = this.supplierProfilesById.get(supplierId);
        return profile?.business_name || fallbackName || '';
    }

    resolveCartItem(item) {
        const supplierOptionsRaw = this.getSupplierOptionsForItem(item);

        let matchedItem = null;
        if (item.item_id) {
            matchedItem = supplierOptionsRaw.find(candidate => candidate.id === item.item_id) || null;
        }

        if (!matchedItem && item.supplier_id) {
            matchedItem = supplierOptionsRaw.find(candidate => candidate.supplier_id === item.supplier_id) || null;
        }

        if (!matchedItem) {
            matchedItem = supplierOptionsRaw[0] || null;
        }

        if (!matchedItem && item.item_id) {
            matchedItem = this.availableItemsById.get(item.item_id) || null;
        }

        if (!matchedItem) {
            const fallbackNameMatch = this.availableItemsByName.get(this.normalizeText(item.item_name));
            matchedItem = fallbackNameMatch || null;
        }

        if (!matchedItem) {
            return {
                isAvailable: false,
                supplierName: null,
                supplierBusinessName: null,
                stockQuantity: 0,
                message: 'Out of stock',
                itemId: null,
                supplierId: null,
                itemName: item.item_name,
                price: item.price,
                supplierOptions: [],
                selectedItemId: null
            };
        }

        const availableQuantity = Number(matchedItem.stock_quantity || 0);
        const requestedQuantity = Number(item.quantity || 0);
        const isAvailable = matchedItem.in_stock && availableQuantity >= requestedQuantity;
        const supplierName = matchedItem.user_profiles?.name || null;
        const supplierBusinessName = matchedItem.user_profiles?.business_name || null;
        const supplierOptions = supplierOptionsRaw.map(option => ({
            itemId: option.id,
            supplierId: option.supplier_id,
            supplierName: this.getSupplierDisplayName(option.supplier_id, option.user_profiles?.name) || 'Unknown supplier',
            supplierBusinessName: this.getSupplierBusinessName(option.supplier_id, option.user_profiles?.business_name),
            price: Number(option.price || 0),
            unit: option.unit
        }));

        return {
            isAvailable,
            supplierName,
            supplierBusinessName,
            stockQuantity: availableQuantity,
            message: isAvailable ? 'Available' : 'Out of stock',
            itemId: matchedItem.id,
            supplierId: matchedItem.supplier_id,
            itemName: matchedItem.name,
            price: matchedItem.price,
            supplierOptions,
            selectedItemId: matchedItem.id
        };
    }

    async updateCartSupplierSelection(cartItemId, selectedSupplierItemId) {
        try {
            const selectedItem = await supabase.database
                .from('items')
                .select('*')
                .eq('id', selectedSupplierItemId)
                .single()
                .execute();

            if (!selectedItem) {
                alert('Selected supplier item is no longer available. Please refresh cart.');
                return;
            }

            await supabase.database
                .from('cart_items')
                .update({
                    supplier_id: selectedItem.supplier_id,
                    item_id: selectedItem.id,
                    price: selectedItem.price
                })
                .eq('id', cartItemId)
                .eq('vendor_id', this.currentUser.id)
                .execute();

            await this.loadCart();
        } catch (error) {
            console.error('Error updating supplier choice:', error);
            alert('Failed to update supplier selection. Please try again.');
        }
    }

    bindCartSupplierSelectors() {
        const selectors = document.querySelectorAll('.cart-supplier-select');
        selectors.forEach(selectEl => {
            selectEl.addEventListener('change', (e) => {
                const cartItemId = e.currentTarget.dataset.cartItemId;
                const selectedSupplierItemId = e.currentTarget.value;
                this.updateCartSupplierSelection(cartItemId, selectedSupplierItemId);
            });
        });
    }

    bindCartRemoveButtons() {
        const removeButtons = document.querySelectorAll('.cart-remove-btn');
        removeButtons.forEach(button => {
            button.addEventListener('click', () => {
                const cartItemId = button.dataset.cartItemId;
                this.removeFromCart(cartItemId);
            });
        });
    }

    displayCart() {
        const cartItems = document.getElementById('cartItems');
        const total = this.cart.reduce((sum, item) => {
            const effectivePrice = Number(item.resolved_price ?? item.price ?? 0);
            return sum + (effectivePrice * Number(item.quantity || 0));
        }, 0);
        const unavailableItems = this.getUnavailableCartItems();
        const warningHtml = unavailableItems.length > 0 ? `
            <div class="cart-stock-warning" role="alert">
                <strong>Some items in the cart are out of stock.</strong>
                <p>Remove or replace unavailable items before placing the order.</p>
            </div>
        ` : '';

        if (this.cart.length === 0) {
            cartItems.innerHTML = '<div class="empty-cart">Your cart is empty</div>';
        } else {
            cartItems.innerHTML = `${warningHtml}${this.cart.map(item => `
                <div class="cart-item">
                    <div class="cart-item-info">
                        <h4>${item.item_name}</h4>
                        ${item.supplier_options && item.supplier_options.length > 1 ? `
                            <div class="cart-supplier-picker">
                                <label class="cart-supplier-label" for="supplierSelect-${item.id}">Supplier</label>
                                <select class="cart-supplier-select" id="supplierSelect-${item.id}" data-cart-item-id="${item.id}">
                                    ${item.supplier_options.map(option => `
                                        <option value="${option.itemId}" ${option.itemId === item.selected_supplier_item_id ? 'selected' : ''}>
                                            ${(option.supplierBusinessName || option.supplierName)} - ₹${option.price}/${option.unit}
                                        </option>
                                    `).join('')}
                                </select>
                            </div>
                        ` : `
                            <p class="cart-item-supplier">
                                ${item.is_available
                                    ? `Supplier: ${item.supplier_business_name || item.supplier_name || 'Unknown supplier'}`
                                    : 'Out of stock'}
                            </p>
                        `}
                        <p>Quantity: ${item.quantity} ${item.unit}</p>
                        ${item.from_ingredients ? `<p>From dish: ${item.dish_name}</p>` : ''}
                        <p class="cart-item-status ${item.is_available ? 'in-stock' : 'out-of-stock'}">
                            ${item.availability_message}
                        </p>
                        <p class="cart-item-price">₹${Number(item.resolved_price ?? item.price ?? 0)}</p>
                    </div>
                    <button class="btn btn-danger btn-small cart-remove-btn" data-cart-item-id="${item.id}">
                        Remove
                    </button>
                </div>
            `).join('')}`;
        }

        document.getElementById('cartTotal').textContent = total.toFixed(2);
        this.bindCartSupplierSelectors();
        this.bindCartRemoveButtons();
        this.updateCheckoutState();
    }

    async removeFromCart(itemId) {
        try {
            if (!itemId) {
                console.error('Missing cart item id for remove action');
                alert('Unable to remove this item right now. Please refresh and try again.');
                return;
            }

            const target = this.cart.find(item => String(item.id) === String(itemId));
            if (!target) {
                console.error('Cart item not found for remove action:', itemId);
                alert('Item not found in cart. Please refresh and try again.');
                return;
            }

            await supabase.database
                .from('cart_items')
                .delete()
                .eq('id', itemId)
                .eq('vendor_id', this.currentUser.id)
                .execute();

            await this.loadSupplierItems();
            await this.loadCart();
        } catch (error) {
            console.error('Error removing from cart:', error);
        }
    }

    async loadSupplierItems() {
        try {
            const items = await supabase.database
                .from('items')
                .select(`
                    *,
                    user_profiles!supplier_id (name, business_name)
                `)
                .execute();

            const supplierIds = [...new Set(items.map(item => item.supplier_id).filter(Boolean))];
            this.supplierProfilesById = new Map();

            if (supplierIds.length > 0) {
                const supplierProfiles = await supabase.database
                    .from('user_profiles')
                    .select('id,name,business_name,user_type')
                    .eq('user_type', 'supplier')
                    .execute();

                supplierProfiles
                    .filter(profile => supplierIds.includes(profile.id))
                    .forEach(profile => {
                        this.supplierProfilesById.set(profile.id, profile);
                    });
            }

            this.availableItems = items;
            this.availableItemsById = new Map(items.map(item => [item.id, item]));
            this.availableItemsByName = new Map(items.map(item => [this.normalizeText(item.name), item]));
            this.filterBrowseItems();
        } catch (error) {
            console.error('Error loading supplier items:', error);
        }
    }

    filterBrowseItems() {
        const searchInput = document.getElementById('browseSearchInput');
        const categoryFilter = document.getElementById('categoryFilter');
        const searchTerm = this.normalizeText(searchInput?.value || '');
        const category = this.normalizeText(categoryFilter?.value || '');

        let filteredItems = [...this.availableItems].filter(item => {
            const stockQty = Number(item?.stock_quantity ?? 0);
            const inStock = item?.in_stock !== false;
            return inStock && stockQty > 0;
        });

        if (category) {
            filteredItems = filteredItems.filter(item => this.normalizeText(item?.category || '') === category);
        }

        if (searchTerm) {
            filteredItems = filteredItems.filter(item => {
                const itemName = this.normalizeText(item?.name || item?.item_name || '');
                const supplierName = this.normalizeText(this.getSupplierDisplayName(item?.supplier_id, item?.user_profiles?.business_name || item?.user_profiles?.name));
                const categoryName = this.normalizeText(item?.category || '');
                const unitName = this.normalizeText(item?.unit || '');
                const searchableText = `${itemName} ${supplierName} ${categoryName} ${unitName}`;
                return searchableText.includes(searchTerm);
            });
        }

        this.displaySupplierItems(filteredItems);
    }

    displaySupplierItems(items) {
        const itemsGrid = document.getElementById('itemsGrid');

        if (!items || items.length === 0) {
            itemsGrid.innerHTML = '<div class="empty-inventory">No items found for the selected filters.</div>';
            return;
        }
        
        itemsGrid.innerHTML = items.map(item => `
            <div class="item-card">
                <div class="item-info">
                    <h4>${item.name}</h4>
                    <p class="item-category">${item.category}</p>
                    <p class="item-supplier">By: ${this.getSupplierDisplayName(item.supplier_id, item.user_profiles?.business_name || item.user_profiles?.name) || 'Unknown supplier'}</p>
                    <p class="item-price">₹${item.price}/${item.unit}</p>
                </div>
                <button class="btn btn-primary add-to-cart-btn" data-item-id="${item.id}" data-item-name="${item.name}" data-item-price="${item.price}" data-item-unit="${item.unit}" data-supplier-id="${item.supplier_id}">
                    Add to Cart
                </button>
            </div>
        `).join('');

        itemsGrid.querySelectorAll('.add-to-cart-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const itemId = button.dataset.itemId;
                const itemName = button.dataset.itemName;
                const itemPrice = button.dataset.itemPrice;
                const itemUnit = button.dataset.itemUnit;
                const supplierId = button.dataset.supplierId;
                const quantity = prompt(`Enter quantity for ${itemName} (unit: ${itemUnit}):`, '1');
                if (quantity === null) return;
                const qty = Number(quantity);
                if (isNaN(qty) || qty <= 0) {
                    alert('Please enter a valid quantity');
                    return;
                }
                this.addBrowseItemToCart({
                    id: itemId,
                    name: itemName,
                    price: Number(itemPrice),
                    unit: itemUnit,
                    quantity: qty,
                    supplier_id: supplierId
                });
            });
        });
    }

    async addBrowseItemToCart(item) {
        try {
            const cartItem = {
                vendor_id: this.currentUser.id,
                supplier_id: this.normalizeNullableValue(item.supplier_id),
                item_name: item.name,
                quantity: Number(item.quantity || 1),
                price: Number(item.price || 0),
                unit: item.unit,
                from_ingredients: false,
                dish_name: null,
                item_id: this.normalizeNullableValue(item.id)
            };
            await this.insertCartItem(cartItem);
            alert(`${item.name} added to cart!`);
            await this.loadCart();
        } catch (error) {
            console.error('Error adding to cart:', error);
            alert('Failed to add item to cart. Please try again.');
        }
    }

    async checkout() {
        if (this.cart.length === 0) {
            alert('Your cart is empty');
            return;
        }

        const unavailableItems = this.cart.filter(item => !item.is_available);
        if (unavailableItems.length > 0) {
            alert('Some items in the cart are out of stock.');
            return;
        }

        if (confirm('Place order for all items in cart?')) {
            try {
                const itemsBySupplier = {};
                this.cart.forEach(item => {
                    const supplierId = item.resolved_supplier_id || item.supplier_id || 'unknown';
                    if (!itemsBySupplier[supplierId]) {
                        itemsBySupplier[supplierId] = [];
                    }
                    itemsBySupplier[supplierId].push(item);
                });

                for (const [supplierId, items] of Object.entries(itemsBySupplier)) {
                    const totalAmount = items.reduce((sum, item) => sum + (item.resolved_price * item.quantity), 0);

                    const order = await supabase.database.from('orders').insert({
                        vendor_id: this.currentUser.id,
                        supplier_id: supplierId !== 'unknown' ? supplierId : null,
                        total_amount: totalAmount,
                        status: 'pending'
                    });

                    for (const item of items) {
                        await supabase.database.from('order_items').insert({
                            order_id: order[0].id,
                            item_name: item.item_name,
                            quantity: item.quantity,
                            price: item.resolved_price,
                            unit: item.unit,
                            from_ingredients: item.from_ingredients,
                            dish_name: item.dish_name
                        });
                    }
                }

                await supabase.database
                    .from('cart_items')
                    .delete()
                    .eq('vendor_id', this.currentUser.id)
                    .execute();

                await this.loadSupplierItems();
                await this.loadCart();
                alert('Order placed successfully!');
                this.switchTab('orders');
            } catch (error) {
                console.error('Error placing order:', error);
                alert('Failed to place order');
            }
        }
    }

    async loadOrders() {
        try {
            const orders = await supabase.database
                .from('orders')
                .select('*,order_items(*)')
                .eq('vendor_id', this.currentUser.id)
                .execute();

            this.displayOrders(orders);
        } catch (error) {
            console.error('Error loading orders:', error);
        }
    }

    displayOrders(orders) {
        const ordersList = document.getElementById('ordersList');
        
        if (orders.length === 0) {
            ordersList.innerHTML = '<div class="empty-orders">No orders found</div>';
            return;
        }

        ordersList.innerHTML = orders.map(order => `
            <div class="order-card">
                <div class="order-header">
                    <h4>Order #${order.id.substring(0, 8)}</h4>
                    <span class="order-status status-${order.status}">${order.status}</span>
                </div>
                <div class="order-details">
                    <p>Total: ₹${order.total_amount}</p>
                    <p>Date: ${new Date(order.created_at).toLocaleDateString()}</p>
                    <p>Items: ${order.order_items?.length || 0}</p>
                    <div class="order-items">
                        ${(order.order_items || []).map(item => `
                            <div class="order-item">
                                <span>${item.item_name}</span>
                                <span>${item.quantity} ${item.unit}</span>
                                <span>₹${item.price}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `).join('');
    }

    showNoResults() {
        this.currentRecipe = null;
        this.setRecipeButtonVisibility(false);
        document.getElementById('ingredientsList').innerHTML = 
            '<div class="no-results">No ingredients found for this dish. Try a different search term.</div>';
        document.getElementById('ingredientsResult').classList.remove('hidden');
    }

    async logout() {
        if (confirm('Are you sure you want to logout?')) {
            await supabase.auth.signOut();
            window.location.href = 'index.html';
        }
    }
}

// Initialize dashboard when page loads
let vendorDashboard;
document.addEventListener('DOMContentLoaded', () => {
    vendorDashboard = new VendorDashboard();
});
