<div class="flex h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans">
  <!-- Sidebar -->
  <aside class="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
    <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
      <h1 class="text-xl font-bold">iikiti</h1>
      <a href="/settings" class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">⚙️</a>
    </div>
    <div class="p-2 overflow-y-auto flex-1">
      <div class="font-bold text-xs uppercase text-gray-500 mb-2 px-2">Feeds</div>
      <ul>
        <!-- Feed List -->
        <li class="px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer">All Articles</li>
      </ul>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="flex-1 flex flex-col">
    <header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
      <h2 class="font-semibold text-lg">All Articles</h2>
      <input type="search" placeholder="Search..." class="border rounded px-3 py-1 bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </header>
    <div class="flex-1 overflow-y-auto p-4">
      <!-- Article List -->
      <div class="bg-white dark:bg-gray-800 p-4 rounded shadow mb-4">
        <h3 class="font-bold text-lg mb-1">Welcome to iikiti</h3>
        <p class="text-gray-600 dark:text-gray-400 text-sm mb-2">System - Just now</p>
        <p>Your feeds will appear here once added.</p>
      </div>
    </div>
  </main>
</div>
