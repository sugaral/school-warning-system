import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/course/' + url, ...arg)

export default {
	coursePage(data) {
		return request('page', data, 'get')
	},
	courseList(data) {
		return request('list', data, 'get')
	},
	submitForm(data, edit = false) {
		return request(edit ? 'edit' : 'add', data)
	},
	courseDelete(data) {
		return request('delete', data)
	},
	courseDetail(data) {
		return request('detail', data, 'get')
	},
	courseImportTemplate() {
		return request('importTemplate', {}, 'get', { responseType: 'blob' })
	},
	courseImport(formData, dryRun = false) {
		return request(`import?dryRun=${dryRun}`, formData, 'post', {
			headers: { 'Content-Type': 'multipart/form-data' }
		})
	},
	orgTreeSelector(data) {
		return request('orgTreeSelector', data, 'get')
	}
}
