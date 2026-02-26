<div class="p-8 bg-gray-100 dark:bg-gray-900 min-h-screen text-gray-900 dark:text-gray-100">
  <div class="max-w-2xl mx-auto bg-white dark:bg-gray-800 p-6 rounded shadow">
    <h1 class="text-2xl font-bold mb-4 border-b border-gray-200 dark:border-gray-700 pb-2">Settings</h1>
    <div class="mb-4">
      <h2 class="font-semibold mb-2">Data Management</h2>
      <button class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mr-2">Import OPML</button>
      <button class="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 font-bold py-2 px-4 rounded">Export OPML</button>
    </div>
    <div class="mb-4">
      <h2 class="font-semibold mb-2">Storage</h2>
      <p class="text-sm text-gray-600 dark:text-gray-400">IndexedDB Usage: <span id="db-usage">Calculating...</span></p>
    </div>
    <div class="mb-4">
      <h2 class="font-semibold mb-2">Preferences</h2>
      <label class="flex items-center space-x-2">
        <input type="checkbox" class="form-checkbox text-blue-600">
        <span>Dark Mode (System Default)</span>
      </label>
    </div>
  </div>
</div>
